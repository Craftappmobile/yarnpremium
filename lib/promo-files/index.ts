// Written by scripts/promo-import.mjs: every discount file in this folder.
import type { PromoFile } from "@/lib/promo"
import f_italiiskyi_stok from "./italiiskyi-stok.json"
import f_kashemir_z_shovkom from "./kashemir-z-shovkom.json"
import f_kashemir from "./kashemir.json"
import f_merynos from "./merynos.json"
import f_shyshybryky_700 from "./shyshybryky-700.json"

export const PROMO_FILES: PromoFile[] = [f_italiiskyi_stok, f_kashemir_z_shovkom, f_kashemir, f_merynos, f_shyshybryky_700]
