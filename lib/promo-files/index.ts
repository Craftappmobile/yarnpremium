// Written by scripts/promo-import.mjs: every discount file in this folder.
import type { PromoFile } from "@/lib/promo"
import f_kashemir from "./kashemir.json"
import f_shyshybryky_700 from "./shyshybryky-700.json"

export const PROMO_FILES: PromoFile[] = [f_kashemir, f_shyshybryky_700]
