/*
 * Per-unit metadata, keyed by ISO 3166-2 — the code statistical data joins on.
 *
 * All 27 administrative units are listed. Kyiv City (UA-30) and Sevastopol
 * (UA-40) carry a `parent`; by default they are unioned into that parent, so
 * the map has the 25 regions the 2012 version had. `kyivSeparate` / the
 * `--kyiv-separate` flag splits Kyiv back out, which is what you want when a
 * table has its own row for the capital.
 *
 * area  km², official figures.
 * pop   thousands, State Statistics Service estimate for 1 Jan 2022 — i.e.
 *       before the full-scale invasion. Crimea and Sevastopol are 2014, the
 *       last figures Ukraine published. Indicative, not current.
 *
 * lon/lat   the administrative center, WGS84. build/geo.sh projects it.
 * off       label offset from the city dot, in display units at the standard
 *           1000-unit map width, i.e. thousandths of the map's width.
 * anchor    's' start | 'm' middle | 'e' end — which side of the dot the text
 *           grows toward.
 *
 * `off` and `anchor` are hand-tuned so every label sits inside its own region,
 * the way the 2012 map did it. `npm run check-labels` verifies that mechanically
 * and prints anything that spills. Keep offsets small: a label that wanders far
 * from its dot stops reading as belonging to it. The checker warns past 16.
 */

const UNITS = [
  // key      uk (oblast adj.)      en                city uk            city en           lon      lat      area    pop    off        anchor
  { k: 'UA-07', uk: 'Волинська',        en: 'Volyn',          cuk: 'Луцьк',            cen: 'Lutsk',          lon: 25.3350, lat: 50.7470, area: 20144, pop: 1021, off: [0, -8], anchor: 'm' },
  { k: 'UA-56', uk: 'Рівненська',       en: 'Rivne',          cuk: 'Рівне',            cen: 'Rivne',          lon: 26.2510, lat: 50.6190, area: 20047, pop: 1141, off: [0, -8], anchor: 'm' },
  { k: 'UA-18', uk: 'Житомирська',      en: 'Zhytomyr',       cuk: 'Житомир',          cen: 'Zhytomyr',       lon: 28.6580, lat: 50.2550, area: 29832, pop: 1179, off: [0, -8], anchor: 'm' },
  { k: 'UA-32', uk: 'Київська',         en: 'Kyiv',           cuk: 'Київ',             cen: 'Kyiv',           lon: 30.5230, lat: 50.4500, area: 28131, pop: 1788, off: [0, 14], anchor: 'e' },
  { k: 'UA-30', uk: 'Київ',             en: 'Kyiv City',      cuk: 'Київ',             cen: 'Kyiv',           lon: 30.5230, lat: 50.4500, area:   839, pop: 2952, off: [0, 14], anchor: 'e', parent: 'UA-32', capital: true },
  { k: 'UA-74', uk: 'Чернігівська',     en: 'Chernihiv',      cuk: 'Чернігів',         cen: 'Chernihiv',      lon: 31.2890, lat: 51.4940, area: 31865, pop:  959, off: [0, -8], anchor: 'm' },
  { k: 'UA-59', uk: 'Сумська',          en: 'Sumy',           cuk: 'Суми',             cen: 'Sumy',           lon: 34.7990, lat: 50.9070, area: 23834, pop: 1035, off: [0, 14], anchor: 'm' },
  { k: 'UA-63', uk: 'Харківська',       en: 'Kharkiv',        cuk: 'Харків',           cen: 'Kharkiv',        lon: 36.2320, lat: 49.9880, area: 31415, pop: 2598, off: [0, 14], anchor: 'm' },
  { k: 'UA-09', uk: 'Луганська',        en: 'Luhansk',        cuk: 'Луганськ',         cen: 'Luhansk',        lon: 39.3170, lat: 48.5740, area: 26684, pop: 2102, off: [0, -6], anchor: 'e' },
  { k: 'UA-14', uk: 'Донецька',         en: 'Donetsk',        cuk: 'Донецьк',          cen: 'Donetsk',        lon: 37.8020, lat: 48.0150, area: 26517, pop: 4059, off: [0, -8], anchor: 'm' },
  { k: 'UA-23', uk: 'Запорізька',       en: 'Zaporizhzhia',   cuk: 'Запоріжжя',        cen: 'Zaporizhzhia',   lon: 35.1390, lat: 47.8380, area: 27180, pop: 1613, off: [3, -6], anchor: 's' },
  { k: 'UA-65', uk: 'Херсонська',       en: 'Kherson',        cuk: 'Херсон',           cen: 'Kherson',        lon: 32.6170, lat: 46.6350, area: 28461, pop: 1001, off: [0, 14], anchor: 's' },
  { k: 'UA-43', uk: 'Крим',             en: 'Crimea',         cuk: 'Сімферополь',      cen: 'Simferopol',     lon: 34.1000, lat: 44.9520, area: 26081, pop: 1913, off: [0, -8], anchor: 'm', ar: true },
  { k: 'UA-40', uk: 'Севастополь',      en: 'Sevastopol',     cuk: 'Севастополь',      cen: 'Sevastopol',     lon: 33.5250, lat: 44.6160, area:   864, pop:  449, off: [0, -8], anchor: 'm', parent: 'UA-43' },
  { k: 'UA-48', uk: 'Миколаївська',     en: 'Mykolaiv',       cuk: 'Миколаїв',         cen: 'Mykolaiv',       lon: 31.9950, lat: 46.9750, area: 24598, pop: 1091, off: [0, -8], anchor: 'm' },
  { k: 'UA-51', uk: 'Одеська',          en: 'Odesa',          cuk: 'Одеса',            cen: 'Odesa',          lon: 30.7330, lat: 46.4820, area: 33310, pop: 2351, off: [0, -6], anchor: 'e' },
  { k: 'UA-05', uk: 'Вінницька',        en: 'Vinnytsia',      cuk: 'Вінниця',          cen: 'Vinnytsia',      lon: 28.4680, lat: 49.2330, area: 26513, pop: 1509, off: [0, -8], anchor: 'm' },
  { k: 'UA-68', uk: 'Хмельницька',      en: 'Khmelnytskyi',   cuk: 'Хмельницький',     cen: 'Khmelnytskyi',   lon: 26.9870, lat: 49.4230, area: 20645, pop: 1229, off: [0, -8], anchor: 'm' },
  { k: 'UA-61', uk: 'Тернопільська',    en: 'Ternopil',       cuk: 'Тернопіль',        cen: 'Ternopil',       lon: 25.5950, lat: 49.5540, area: 13823, pop: 1021, off: [0, -8], anchor: 'm' },
  { k: 'UA-46', uk: 'Львівська',        en: 'Lviv',           cuk: 'Львів',            cen: 'Lviv',           lon: 24.0320, lat: 49.8420, area: 21833, pop: 2478, off: [0, -8], anchor: 'm' },
  { k: 'UA-21', uk: 'Закарпатська',     en: 'Zakarpattia',    cuk: 'Ужгород',          cen: 'Uzhhorod',       lon: 22.2970, lat: 48.6210, area: 12777, pop: 1244, off: [0, 14], anchor: 's' },
  { k: 'UA-26', uk: 'Івано-Франківська',en: 'Ivano-Frankivsk',cuk: 'Івано-Франківськ', cen: 'Ivano-Frankivsk',lon: 24.7110, lat: 48.9230, area: 13928, pop: 1351, off: [-14, 14], anchor: 'm' },
  { k: 'UA-77', uk: 'Чернівецька',      en: 'Chernivtsi',     cuk: 'Чернівці',         cen: 'Chernivtsi',     lon: 25.9350, lat: 48.2920, area:  8097, pop:  890, off: [0, 14], anchor: 'e' },
  { k: 'UA-71', uk: 'Черкаська',        en: 'Cherkasy',       cuk: 'Черкаси',          cen: 'Cherkasy',       lon: 32.0600, lat: 49.4440, area: 20900, pop: 1151, off: [0, 14], anchor: 'e' },
  { k: 'UA-35', uk: 'Кіровоградська',   en: 'Kirovohrad',     cuk: 'Кропивницький',    cen: 'Kropyvnytskyi',  lon: 32.2630, lat: 48.5080, area: 24588, pop:  906, off: [0, -8], anchor: 'm', renamed: 2016 },
  { k: 'UA-53', uk: 'Полтавська',       en: 'Poltava',        cuk: 'Полтава',          cen: 'Poltava',        lon: 34.5510, lat: 49.5890, area: 28748, pop: 1362, off: [0, -8], anchor: 'm' },
  { k: 'UA-12', uk: 'Дніпропетровська', en: 'Dnipropetrovsk', cuk: 'Дніпро',           cen: 'Dnipro',         lon: 35.0450, lat: 48.4520, area: 31914, pop: 3096, off: [0, -8], anchor: 'm', renamed: 2016 },
];

/*
 * The unfold order, carried over from the 2012 map: three west-to-east bands.
 * Measured across the whole map-to-grid transition it is the only ordering
 * whose region overlap falls monotonically to zero — alphabetical peaks at
 * about 95% of tile area, by-population at 123%. Rows are handed to the
 * browser as literal line breaks; the flow layout does the rest.
 */
const BANDS = [
  ['UA-21', 'UA-46', 'UA-07', 'UA-56', 'UA-18', 'UA-32', 'UA-74', 'UA-59', 'UA-63'],
  ['UA-26', 'UA-77', 'UA-61', 'UA-68', 'UA-05', 'UA-71', 'UA-35', 'UA-53', 'UA-12'],
  ['UA-51', 'UA-48', 'UA-65', 'UA-43', 'UA-23', 'UA-14', 'UA-09'],
];

/* Water bodies, for naming and for flagging what is no longer accurate.
 *
 * `main` means "part of the default set" — what `--water` draws without
 * `=all`. For the reservoirs that is the Dnipro cascade, which is the river
 * itself widened, and nothing else: the one remaining lake is an untitled
 * Natural Earth feature (ne_id 1159117327, 27.47-27.70E 49.39-49.48N, on the
 * Southern Buh east of Khmelnytskyi). It is the only thing in the default view
 * that is neither the Dnipro nor the sea, so it reads as a stray blob. Left in
 * the data and shown by `--water=all`; not named, because Natural Earth does
 * not name it and guessing would be worse than the generic label. */
const WATER = {
  'Dnipro':        { uk: 'Дніпро', main: true },
  'Dniester':      { uk: 'Дністер' },
  'Southern Bug':  { uk: 'Південний Буг' },
  'Donets':        { uk: 'Сіверський Донець' },
  'Pripyat':       { uk: "Прип'ять" },
  'Prut':          { uk: 'Прут' },
  'Seym':          { uk: 'Сейм' },
  'Mukhavyets':    { uk: 'Мухавець' },
  'Kiev Reservoir':       { uk: 'Київське водосховище', main: true },
  'Kaniv Reservoir':      { uk: 'Канівське водосховище', main: true },
  'Kamianske Reservoir':  { uk: 'Каменське водосховище', main: true },
  'Reservoir':            { uk: 'Водосховище' },   // see above: not the Dnipro
  'Kremenchuk Reservoir': { uk: 'Кременчуцьке водосховище', main: true },
  'Kakhovka Reservoir':   { uk: 'Каховське водосховище', main: true, until: 2023 },
};

module.exports = { UNITS, BANDS, WATER };
