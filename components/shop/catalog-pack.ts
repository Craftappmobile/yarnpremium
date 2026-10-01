import type { Product } from "./data"

// The home page ships the whole in-stock catalog to the browser so search,
// filters and sorting work instantly. Sent as plain objects that is ~550 bytes
// per product, most of it repeated keys, categories, colours and image folders.
// Packed rows with shared string pools carry the same data in about a third.

type Row = [
  sku: string,
  name: string,
  price: number,
  unit: number,
  /** Image folder (pool index, -1 = no image) and file name. */
  imageDir: number,
  imageFile: string,
  category: number,
  stock: number,
  color: number,
  length: number,
  brand: number,
  article: number,
  minQty: number,
  step: number,
]

export interface PackedCatalog {
  pools: { unit: string[]; imageDir: string[]; category: string[]; color: string[]; brand: string[]; article: string[] }
  rows: Row[]
}

function pool() {
  const values: string[] = []
  const index = new Map<string, number>()
  return {
    values,
    id(value: string) {
      let i = index.get(value)
      if (i === undefined) {
        i = values.length
        values.push(value)
        index.set(value, i)
      }
      return i
    },
  }
}

/** For the listing only: description, gallery and offer id stay on the product page. */
export function packCatalog(products: Product[]): PackedCatalog {
  const unit = pool()
  const imageDir = pool()
  const category = pool()
  const color = pool()
  const brand = pool()
  const article = pool()
  const rows = products.map((p): Row => {
    const cut = p.image.lastIndexOf("/") + 1
    return [
      p.sku,
      p.name,
      p.price,
      unit.id(p.priceUnit),
      p.image ? imageDir.id(p.image.slice(0, cut)) : -1,
      p.image.slice(cut),
      category.id(p.category),
      p.stock,
      color.id(p.color),
      p.length,
      brand.id(p.brand),
      article.id(p.article),
      p.minQty,
      p.step,
    ]
  })
  return {
    pools: { unit: unit.values, imageDir: imageDir.values, category: category.values, color: color.values, brand: brand.values, article: article.values },
    rows,
  }
}

export function unpackCatalog({ pools, rows }: PackedCatalog): Product[] {
  return rows.map(([sku, name, price, unit, imageDir, imageFile, category, stock, color, length, brand, article, minQty, step]) => ({
    id: sku,
    offerId: 0,
    sku,
    name,
    description: "",
    price,
    priceUnit: pools.unit[unit],
    image: imageDir < 0 ? "" : pools.imageDir[imageDir] + imageFile,
    images: [],
    category: pools.category[category],
    stock,
    color: pools.color[color],
    length,
    brand: pools.brand[brand],
    article: pools.article[article],
    minQty,
    step,
  }))
}
