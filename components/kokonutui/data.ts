export interface Product {
  id: string
  name: string
  description: string
  price: number
  /** Unit the price is charged per, e.g. "г" (gram). Yarn is priced by weight. */
  priceUnit: string
  image: string
  category: string
  /** Article / SKU. Maps to KeyCRM offer.sku on import. */
  sku: string
  /** Units in stock. Maps to KeyCRM offer.quantity on import. 0 = out of stock. */
  stock: number
  /** Color NAME only. The swatch HEX is resolved from colors.ts (colorHexMap). */
  color: string
  /** Yarn length per skein, in meters */
  length: number
}

export interface CartItem extends Product {
  quantity: number
}

/** Formats a price in UAH with Ukrainian comma decimals, e.g. 2.08 -> "2,08 ₴". */
export function formatPrice(value: number): string {
  return `${value.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴`
}

/**
 * Demo discount coupons. Later these can be resolved from KeyCRM instead of
 * being hardcoded. `type` is "percent" (value = %) or "fixed" (value = ₴).
 */
export interface Coupon {
  code: string
  type: "percent" | "fixed"
  value: number
  /** Optional minimum subtotal (₴) required for the coupon to apply. */
  minSubtotal?: number
}

export const coupons: Coupon[] = [
  { code: "SINSERITA10", type: "percent", value: 10 },
  { code: "YARN50", type: "fixed", value: 50, minSubtotal: 100 },
]

export type CouponResult =
  | { ok: true; coupon: Coupon; discount: number }
  | { ok: false; error: string }

/** Validates a coupon against the current subtotal and returns the discount amount (₴). */
export function applyCoupon(code: string, subtotal: number): CouponResult {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return { ok: false, error: "Введіть код купону" }
  const coupon = coupons.find((c) => c.code === normalized)
  if (!coupon) return { ok: false, error: "Купон не знайдено або недійсний" }
  if (coupon.minSubtotal && subtotal < coupon.minSubtotal) {
    return { ok: false, error: `Купон діє від суми ${formatPrice(coupon.minSubtotal)}` }
  }
  const raw = coupon.type === "percent" ? (subtotal * coupon.value) / 100 : coupon.value
  // Never discount below zero.
  const discount = Math.min(raw, subtotal)
  return { ok: true, coupon, discount }
}

export type SortOption = "default" | "price-asc" | "price-desc" | "length-asc" | "length-desc" | "name-asc"

export const sortOptions: { value: SortOption; label: string }[] = [
  { value: "default", label: "За замовчуванням" },
  { value: "price-asc", label: "Ціна: від дешевших" },
  { value: "price-desc", label: "Ціна: від дорожчих" },
  { value: "length-asc", label: "Метраж: від меншого" },
  { value: "length-desc", label: "Метраж: від більшого" },
  { value: "name-asc", label: "Назва: А–Я" },
]

/** Returns a new sorted array; keeps the original order for "default". */
export function sortProducts<T extends Product>(items: T[], sort: SortOption): T[] {
  const copy = [...items]
  switch (sort) {
    case "price-asc":
      return copy.sort((a, b) => a.price - b.price)
    case "price-desc":
      return copy.sort((a, b) => b.price - a.price)
    case "length-asc":
      return copy.sort((a, b) => a.length - b.length)
    case "length-desc":
      return copy.sort((a, b) => b.length - a.length)
    case "name-asc":
      return copy.sort((a, b) => a.name.localeCompare(b.name, "uk"))
    default:
      return copy
  }
}

/** Current catalog entry for a product id (used to restore a saved cart/wishlist). */
export function getProductById(id: string): Product | undefined {
  return products.find((p) => p.id === id)
}

/**
 * Slider bounds that cover every product: price rounded out to whole hryvnias,
 * length rounded out to the 10 m slider step.
 */
export function getFilterBounds(items: Product[]): { price: [number, number]; length: [number, number] } {
  if (items.length === 0) return { price: [0, 0], length: [0, 0] }
  const prices = items.map((p) => p.price)
  const lengths = items.map((p) => p.length)
  return {
    price: [Math.floor(Math.min(...prices)), Math.ceil(Math.max(...prices))],
    length: [Math.floor(Math.min(...lengths) / 10) * 10, Math.ceil(Math.max(...lengths) / 10) * 10],
  }
}

// Full yarn category taxonomy (alphabetical). The filter derives its list from
// here, while product counts are computed from the `products` array below.
export const categoryList: string[] = [
  "Акційний товар",
  "Альпака",
  "Ангора",
  "Ангора суміш",
  "Бебі лама з мериносом",
  "Бусинки",
  "Велюр",
  "Велюровий котон",
  "Верблюд суміш",
  "Віскоза",
  "Вспушений меринос",
  "Евкаліпт",
  "Засоби для прання",
  "Кашемір",
  "Кашемір Котон",
  "Кашемір меринос",
  "Кашемір меринос віскоза",
  "Кашемір Меринос Шовк",
  "Кашемір Шовк",
  "Кід мохер",
  "Кід на шовку бобінний",
  "Коноплля",
  "Королівська пайєтка",
  "Котон",
  "Котон шовк",
  "Кропива",
  "Льон",
  "Льон з пайєткою та люрексом",
  "Льон Шовк",
  "Люрекс товстий",
  "Люрекс тонкий",
  "Меринос",
  "Меринос верблюд",
  "Меринос віскоза",
  "Меринос з ангорою",
  "Меринос з еластаном",
  "Меринос з пайєткою",
  "Меринос Льон",
  "Меринос Мохер",
  "Меринос шовк",
  "Меринос шовк льон",
  "Мериноси товсті",
  "Мериноси тонкі",
  "Мікропаєстка на бавовні",
  "Мікропаєстка по 195 грн",
  "Мікропайєтка на нейлоні",
  "Мохер 30%",
  "Напіввовна",
  "Пайєтка на нейлоні",
  "Пряжа Букле",
  "Спиці",
  "СуперКід мохер на шовку",
  "Твід",
  "Травка",
  "Шишибрики букле",
  "Шишибрики на котоні",
  "Шишибрики тонкі",
  "Шкарпеткова пряжа",
  "Шовк",
  "Шовк буретний",
  "Ягня",
  "Як",
  "Як суміш",
]

// A short, curated set surfaced as quick-access pills in the top bar. The full
// taxonomy stays searchable in the sidebar via categoryList.
export const popularCategories: string[] = [
  "Меринос",
  "Кашемір",
  "Альпака",
  "Ангора",
  "Шовк",
  "Меринос шовк",
  "Кашемір меринос",
  "Мохер 30%",
]

export const products: Product[] = [
  {
    id: "p1",
    name: "Minimal Desk Lamp",
    description: "A sleek and modern desk lamp with adjustable brightness and color temperature.",
    price: 89,
    priceUnit: "г",
    sku: "L401",
    stock: 35,
    image:
      "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    category: "Меринос",
    color: "Black",
    length: 400,
  },
  {
    id: "p2",
    name: "Ceramic Coffee Set",
    description: "Handcrafted ceramic coffee set including 4 cups and a matching pour-over dripper.",
    price: 65,
    priceUnit: "г",
    sku: "L402",
    stock: 12,
    image:
      "https://images.unsplash.com/photo-1517256064527-09c73fc73e38?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    category: "Кашемір",
    color: "White",
    length: 800,
  },
  {
    id: "p3",
    name: "Linen Throw Pillow",
    description: "Soft linen throw pillow with minimalist pattern design.",
    price: 45,
    priceUnit: "г",
    sku: "L403",
    stock: 8,
    image:
      "https://images.unsplash.com/photo-1579656381226-5fc0f0100c3b?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    category: "Альпака",
    color: "Beige",
    length: 250,
  },
  {
    id: "p4",
    name: "Wooden Wall Clock",
    description: "Modern wooden wall clock with silent movement.",
    price: 79,
    priceUnit: "г",
    sku: "L404",
    stock: 3,
    image:
      "https://images.unsplash.com/photo-1563861826100-9cb868fdbe1c?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    category: "Ангора",
    color: "Wood",
    length: 550,
  },
  {
    id: "p5",
    name: "Concrete Planter",
    description: "Minimalist concrete planter perfect for succulents.",
    price: 34,
    priceUnit: "г",
    sku: "L405",
    stock: 50,
    image:
      "https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    category: "Мохер 30%",
    color: "Gray",
    length: 1000,
  },
  {
    id: "p6",
    name: "Glass Vase Set",
    description: "Set of 3 minimalist glass vases in varying sizes.",
    price: 55,
    priceUnit: "г",
    sku: "L406",
    stock: 0,
    image:
      "https://images.unsplash.com/photo-1581783898377-1c85bf937427?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    category: "Шовк",
    color: "White",
    length: 300,
  },
  {
    id: "p7",
    name: "Bamboo Organizer",
    description: "Desk organizer made from sustainable bamboo.",
    price: 42,
    priceUnit: "г",
    sku: "L407",
    stock: 22,
    image:
      "https://images.unsplash.com/photo-1591129841117-3adfd313e34f?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    category: "Меринос шовк",
    color: "Wood",
    length: 450,
  },
  {
    id: "p9",
    name: "Marble Coasters",
    description: "Set of 4 marble coasters with cork backing.",
    price: 38,
    priceUnit: "г",
    sku: "L409",
    stock: 17,
    image:
      "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    category: "Кашемір меринос",
    color: "White",
    length: 700,
  },
  {
    id: "p10",
    name: "Brass Bookends",
    description: "Modern geometric brass bookends, set of 2.",
    price: 68,
    priceUnit: "г",
    sku: "L410",
    stock: 6,
    image: "https://images.unsplash.com/photo-1544457070-4cd773b4d71e?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    category: "Меринос шовк льон",
    color: "Gold",
    length: 500,
  },
  {
    id: "p11",
    name: "Ceramic Plant Pot",
    description: "Handmade ceramic plant pot with drainage hole.",
    price: 48,
    priceUnit: "г",
    sku: "L411",
    stock: 28,
    image:
      "https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    category: "Меринос",
    color: "Terracotta",
    length: 350,
  },
  {
    id: "p12",
    name: "Wall Mirror",
    description: "Round wall mirror with minimal metal frame.",
    price: 120,
    priceUnit: "г",
    sku: "L412",
    stock: 4,
    image:
      "https://images.unsplash.com/photo-1618220179428-22790b461013?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    category: "Альпака",
    color: "Silver",
    length: 650,
  },
]
