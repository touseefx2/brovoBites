# Bravo Bites POS — Dedicated Chrome profile (shop PC)

Local sales/edits wait in **this browser profile’s IndexedDB** until Firestore syncs.  
Clear browsing data / dusra profile = unsynced sales lost ho sakti hain.

## Windows shop PC — setup once

### 1) Alag Chrome profile

1. Chrome kholo → top-right **profile icon** → **Add** / **Other profile**.
2. Name: **`Bravo Bites POS`** (alag color rakh lo).
3. Is profile me personal Gmail / Facebook mat kholo.

### 2) Live POS bookmark

1. **Bravo Bites POS** profile me Bravo Bites LIVE admin site ka POS link kholo (`https://<live-admin-site>/pos`) — DEV link nahi.
2. Login: **counter** Firebase email.
3. Star dabao → bookmark save (name: `Bravo Bites POS`).
4. Roz sirf yahi profile + yahi bookmark use karo.

### 3) Printer

Windows me thermal printer **Default** set kar do. Is profile se ek test print chala lo.

### 4) Clear Data mat

Is **Bravo Bites POS** profile me:

- **Clear browsing data** kabhi mat
- “Clear on exit” **Off**
- Personal browsing → alag Chrome profile / Edge

### 5) Din band

Banner **Sync pending (0)** check, phir band.

### 6) Agar Clear Data ho jaye

- Jo sync ho chuke → Firebase me safe  
- Jo pending the → is PC se gayab  

---

## Mac (dev)

Profile **`Bravo Bites POS Dev`** → `http://localhost:3001/pos` bookmark. Clear Data mat.
