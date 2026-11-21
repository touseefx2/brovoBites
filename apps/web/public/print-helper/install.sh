#!/bin/bash
# Brovo Bites — counter-Mac print helper (thermal receipt printer, ESC/POS).
#
# The POS website (pos.brovobites.com / pos-dev.brovobites.com) runs in the
# cloud and cannot reach a USB printer. This installs a tiny helper on the
# counter Mac that listens on 127.0.0.1:17800 and sends the receipt bytes the
# POS page posts to it straight to the printer (`lp -o raw`, no driver).
#
# Install / update (on the counter Mac, printer plugged in and ON):
#   curl -fsSL https://pos.brovobites.com/print-helper/install.sh | bash
# Remove:
#   curl -fsSL https://pos.brovobites.com/print-helper/install.sh | bash -s -- --uninstall
#
# Needs nothing extra: macOS ships perl, lp and launchctl (works on 2017 Macs).
set -euo pipefail

PRINTER="${BROVO_PRINTER:-POS80}"
PORT="${BROVO_PRINT_PORT:-17800}"
LABEL="com.brovobites.print"
APP_DIR="$HOME/Library/Application Support/BrovoPrint"
HELPER="$APP_DIR/brovo-print.pl"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/BrovoPrint.log"
UID_NUM="$(id -u)"

stop_agent() {
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
  stop_agent
  rm -f "$PLIST" "$HELPER"
  rmdir "$APP_DIR" 2>/dev/null || true
  echo "Brovo print helper removed. (Printer $PRINTER left as is.)"
  exit 0
fi

echo "== Brovo Bites print helper =="

# ---- 1. Printer queue -------------------------------------------------------
if lpstat -p "$PRINTER" >/dev/null 2>&1; then
  echo "Printer $PRINTER: already set up."
else
  echo "Printer $PRINTER not found — looking for a USB printer..."
  URIS="$(lpinfo -v 2>/dev/null | awk '$1=="direct" && $2 ~ /^usb:/ {print $2}')"
  URI="$(printf '%s\n' "$URIS" | grep -iE 'pos|printer|receipt|thermal' | head -1 || true)"
  [[ -n "$URI" ]] || URI="$(printf '%s\n' "$URIS" | head -1)"
  if [[ -z "$URI" ]]; then
    echo "ERROR: no USB printer found. Plug the printer in (USB-C adapter on a 2017 Mac), turn it ON and run this again."
    exit 1
  fi
  echo "Found: $URI"
  lpadmin -p "$PRINTER" -E -v "$URI" -m drv:///sample.drv/generic.ppd
  echo "Printer $PRINTER added."
fi
cupsenable "$PRINTER" 2>/dev/null || true
cupsaccept "$PRINTER" 2>/dev/null || true

# ---- 2. Helper --------------------------------------------------------------
mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$HELPER" <<'PERL'
#!/usr/bin/perl
# Brovo Bites print helper: POST raw ESC/POS bytes to http://127.0.0.1:PORT/print
use strict;
use warnings;
use IO::Socket::INET;
use File::Temp qw(tempfile);

my $PORT    = $ENV{BROVO_PRINT_PORT} || 17800;
my $PRINTER = $ENV{BROVO_PRINTER}    || 'POS80';
my $MAX     = 2 * 1024 * 1024;
die "bad printer name\n" unless $PRINTER =~ /^[A-Za-z0-9_.-]+$/;
$SIG{PIPE} = 'IGNORE';
$| = 1;

my $server = IO::Socket::INET->new(
  LocalAddr => '127.0.0.1', LocalPort => $PORT, Proto => 'tcp',
  Listen => 10, ReuseAddr => 1,
) or die "cannot listen on 127.0.0.1:$PORT: $!\n";
logmsg("listening on 127.0.0.1:$PORT, printer $PRINTER");

while (my $c = $server->accept) {
  binmode $c;
  eval {
    local $SIG{ALRM} = sub { die "timeout\n" };
    alarm 20;
    handle($c);
    alarm 0;
  };
  alarm 0;
  logmsg("error: $@") if $@;
  close $c;
}

sub logmsg { my @t = localtime; printf "%04d-%02d-%02d %02d:%02d:%02d %s\n", $t[5]+1900, $t[4]+1, @t[3,2,1,0], $_[0]; }

# Only the Brovo Bites POS may print (any *.brovobites.com page, or a local dev server).
sub allowed_origin {
  my ($o) = @_;
  return 1 unless defined $o;   # curl / no browser
  return $o =~ m{^https://([a-z0-9-]+\.)*brovobites\.com$}i
      || $o =~ m{^http://(localhost|127\.0\.0\.1)(:\d+)?$}i;
}

sub reply {
  my ($c, $status, $body, $origin) = @_;
  my %text = (200 => 'OK', 204 => 'No Content', 400 => 'Bad Request', 403 => 'Forbidden',
              404 => 'Not Found', 413 => 'Payload Too Large', 500 => 'Internal Server Error');
  my $h = "HTTP/1.1 $status " . ($text{$status} || 'OK') . "\r\n";
  if (defined $origin && allowed_origin($origin)) {
    $h .= "Access-Control-Allow-Origin: $origin\r\n"
        . "Vary: Origin\r\n"
        . "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        . "Access-Control-Allow-Headers: Content-Type\r\n"
        . "Access-Control-Allow-Private-Network: true\r\n"
        . "Access-Control-Max-Age: 600\r\n";
  }
  $body = '' unless defined $body;
  $h .= "Content-Type: application/json\r\n" if length $body;
  $h .= "Content-Length: " . length($body) . "\r\nConnection: close\r\n\r\n";
  print $c $h . $body;
}

sub json_str { my $s = shift; $s =~ s/(["\\])/\\$1/g; $s =~ s/[\r\n\t]+/ /g; return "\"$s\""; }

sub handle {
  my ($c) = @_;
  my $line = <$c>;
  return unless defined $line;
  my ($method, $path) = $line =~ m{^(\S+)\s+(\S+)};
  return unless $method;
  my %hdr;
  while (my $l = <$c>) {
    $l =~ s/\r?\n$//;
    last if $l eq '';
    $hdr{lc $1} = $2 if $l =~ /^([^:]+):\s*(.*)$/;
  }
  my $origin = $hdr{origin};
  $path =~ s/\?.*$//;

  if (defined $origin && !allowed_origin($origin)) {
    return reply($c, 403, '{"error":"origin not allowed"}');
  }
  return reply($c, 204, '', $origin) if $method eq 'OPTIONS';

  if ($method eq 'GET' && $path eq '/health') {
    return reply($c, 200, '{"ok":true,"printer":' . json_str($PRINTER) . '}', $origin);
  }
  return reply($c, 404, '{"error":"not found"}', $origin) unless $method eq 'POST' && $path eq '/print';

  my $len = $hdr{'content-length'} || 0;
  return reply($c, 400, '{"error":"empty body"}', $origin) unless $len =~ /^\d+$/ && $len > 0;
  return reply($c, 413, '{"error":"too large"}', $origin) if $len > $MAX;
  my $body = '';
  while (length($body) < $len) {
    my $n = read($c, my $chunk, $len - length($body));
    last unless $n;
    $body .= $chunk;
  }
  return reply($c, 400, '{"error":"short body"}', $origin) if length($body) < $len;

  my ($fh, $file) = tempfile('brovo-receipt-XXXXXX', TMPDIR => 1, UNLINK => 0);
  binmode $fh;
  print $fh $body;
  close $fh;

  # A failed USB send pauses the CUPS queue; un-pause it so this job goes out.
  # eval: the 20s alarm can fire while lp hangs — the temp file must still go.
  my ($out, $rc);
  my $ok = eval {
    system("/usr/sbin/cupsenable '$PRINTER' >/dev/null 2>&1");
    $out = `/usr/bin/lp -d '$PRINTER' -o raw '$file' 2>&1`;
    $rc = $?;
    1;
  };
  my $err = $@;
  unlink $file;
  die $err unless $ok;
  if ($rc != 0) {
    logmsg("lp failed: $out");
    return reply($c, 500, '{"error":' . json_str($out || 'lp failed') . '}', $origin);
  }
  logmsg("printed $len bytes" . (defined $origin ? " from $origin" : ''));
  return reply($c, 200, '{"ok":true}', $origin);
}
PERL
chmod 755 "$HELPER"

# ---- 3. Start at login, restart if it stops ---------------------------------
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/perl</string><string>$HELPER</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BROVO_PRINTER</key><string>$PRINTER</string>
    <key>BROVO_PRINT_PORT</key><string>$PORT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

stop_agent
sleep 1
launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"

# ---- 4. Check ---------------------------------------------------------------
ok=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [[ -z "$ok" ]]; then
  echo "ERROR: helper did not start. Log: $LOG"
  tail -5 "$LOG" 2>/dev/null || true
  exit 1
fi
echo "Helper running on 127.0.0.1:$PORT (starts by itself after every restart)."

if [[ "${1:-}" != "--no-test" ]]; then
  printf '\x1B\x40\x1B\x61\x01Brovo Bites\nPrinter ready\n\n\n\n\x1D\x56\x42\x03' \
    | curl -fsS -X POST --data-binary @- -H 'Content-Type: application/octet-stream' \
      "http://127.0.0.1:$PORT/print" >/dev/null && echo "Test slip sent to $PRINTER." \
    || echo "Test slip failed — check the printer is ON with paper (log: $LOG). The helper is installed."
fi

echo ""
echo "Done. Open the POS in Google Chrome. The first time you print, Chrome may ask"
echo "to allow access to apps on this device — click Allow."
