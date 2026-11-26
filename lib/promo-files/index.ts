// Written by scripts/promo-import.mjs: every discount file in this folder.
import type { PromoFile } from "@/lib/promo"
import f_italiiskyi_stok from "./italiiskyi-stok.json"
import f_kashemir_2 from "./kashemir-2.json"
import f_kashemir_z_merynosom from "./kashemir-z-merynosom.json"
import f_kashemir_z_shovkom from "./kashemir-z-shovkom.json"
import f_kashemir from "./kashemir.json"
import f_lon from "./lon.json"
import f_merynos from "./merynos.json"
import f_mikropaietka from "./mikropaietka.json"
import f_napivvovna from "./napivvovna.json"
import f_premialni_sumishi from "./premialni-sumishi.json"
import f_shovk from "./shovk.json"
import f_shyshybryky_700 from "./shyshybryky-700.json"

export const PROMO_FILES: PromoFile[] = [f_italiiskyi_stok, f_kashemir_2, f_kashemir_z_merynosom, f_kashemir_z_shovkom, f_kashemir, f_lon, f_merynos, f_mikropaietka, f_napivvovna, f_premialni_sumishi, f_shovk, f_shyshybryky_700]
