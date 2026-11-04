import type { StockUnit } from "@bravobites/domain";
import type { MessageKey } from "@/i18n/dictionaries";

export const unitLabelKey: Record<StockUnit, MessageKey> = {
  pcs: "unitPcs",
  bottle: "unitBottle",
  can: "unitCan",
  pack: "unitPack",
  plate: "unitPlate",
  kg: "unitKg",
  g: "unitG",
  ltr: "unitLtr",
  ml: "unitMl",
  dozen: "unitDozen",
  box: "unitBox",
  bag: "unitBag",
};
