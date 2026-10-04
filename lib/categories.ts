// One line about what a category's yarn is, for the header over it. The
// catalog shows the «Склад» from KeyCRM by itself where every product of a
// category has the same one; these lines are for the rest: compositions that
// differ from colour to colour, or «Склад» not filled in (most products keep
// it in the description instead). Keep each line true of the whole category,
// ranges included. Categories whose name already says it need none. Keyed by
// the KeyCRM category, as named there.

export const CATEGORY_NOTES: Record<string, string> = {
  "Напіввовна": "50% меринос, 50% синтетика",
  "Шкарпеткова пряжа": "75% меринос, 25% поліамід",
  "Мікропаєтка по 195 грн": "100% поліестер, паєтка 2 мм",
  "Кашемір Шовк": "Кашемір із шовком, 50–70% кашеміру",
  "Мериноси тонкі": "100% меринос",
  "Кашемір меринос": "Меринос із кашеміром",
  "Мериноси товсті": "Меринос, 80–100%",
  "Кід на шовку бобінний": "Кід мохер на шовку, 70–75% кіду",
  "Альпака": "Бебі альпака з мериносом і поліамідом",
  "Меринос шовк льон": "Меринос, шовк і льон",
  "Бусинки": "100% бавовна з бусинкою 3 мм",
  "Льон": "100% льон",
  "Як суміш": "Як із кашеміром, верблюдом або мериносом",
  "Мікропаєтка на бавовні": "100% бавовна з паєткою 3 мм",
  "Меринос шовк": "Меринос із шовком, 70–80% мериносу",
  "Мікропайєтка": "Паєтка 1,5 мм на поліестері",
  "Кашемір": "Кашемір, 82–100%",
  // «c» in «товcтий» is Latin, as in KeyCRM.
  "Люрекс товcтий": "Віскоза з люрексом",
  "Королівська пайєтка": "100% бавовна з паєткою 3 і 6 мм",
  "Альпака бобінна": "Альпака з вовною і поліамідом",
}
