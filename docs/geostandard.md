# Geostandard review

Source: *Geostandard*, version 22.00 (2022), owned by the Norwegian Petroleum Directorate (now Sodir), published and maintained on its behalf by
Equinor. 149 pages, Norwegian and English side by side. <https://www.sodir.no/globalassets/2-force/2022/dokumenter/geostandard-ekstern.pdf>.
Read in full for chapters 1, 3 and 6 (and the map-type list in 7.1) on 2026-11-08. Section numbers below are the standard's own.

The standard is for exchanging maps and displays between companies on the Norwegian shelf. It gives names, required metadata, symbols and colours; it says nothing
about how to generalise or smooth a surface, or about screen design. So: **the Geostandard decides vocabulary, metadata and symbols; the SubScout style guide decides
everything the standard is silent on, and where they conflict the conflict is written down here** (section 7).

Reuse: we cite the standard and redraw every symbol ourselves as SVG paths. We do not copy its graphics. Its colour values are listed as numbers and are quoted
where needed. The document states no licence; check before redistributing any page or table wholesale.

## 1. What applies to us

| Chapter | Content | Used by |
|---|---|---|
| 1.1 | Map types and their definitions | the "Type of document" on every map |
| 1.2 | Title box: required and optional fields | the fact strip, a future title box component |
| 1.3 | Symbols for geological and geophysical maps: contours, highs and lows, folds, faults, unconformities | surface layer, fault overlay |
| 3 | Boreholes, wells and installations: definitions, well references, well symbols, installations | well symbols (SubScout), adapters |
| 6.4, 6.12, 6.18, 6.26, 6.27 | Colours: water depth, hydrocarbon type, structure and thickness scale, faults, contacts | ramps, symbols |
| 7.1, 7.4.8 | Accepted map types; structural element names (Utsirahøgda / Utsira High) | titles, "Area" field |
| 2, 4, 5 | Cross-sections, rock-type symbols, chronostratigraphy | later: cross-sections, formation colours |

## 2. Map types we produce

The standard's names (7.1) are the ones to put on the map. "Type of document" may list several if the map shows several subjects.

| Our map | Standard name | Note |
|---|---|---|
| Horizon in depth | **Depth structure contour map** | "contour map of depth measured from the reference datum down to a seismic reflection surface"; the datum must be stated |
| Horizon in time | **Time structure contour map** | datum: sea level or other relevant reference |
| Hugin base minus top, in depth | **Isochore map** | vertical thickness. *Not* isopach, which is true stratigraphic thickness perpendicular to bedding |
| Time difference between horizons | **Isochron map** | |
| Residual relief | none | derived and non-standard: label "Geophysical map" (a main type) and say "residual to a 1 km regional trend" |
| Wells over a surface | **Posted map** (geophysical) or **Base map** with well positions and status | |
| Faults alone | **Tectonic map** | "on the continental shelf primarily shows faults" |

## 3. Title box (1.2) against our fact strip

Required fields (1.2.2) and what we have today. Labels must be written exactly as in the standard, followed by a colon, in Norwegian or English.

| Standard label | Required | Ours now | Gap |
|---|---|---|---|
| Company | yes | no | the map owner. Ours: Adam McCarthy, derived from Equinor data |
| Country | yes | no | `Norway` (ISO 3166 short form) |
| Area | yes | no | structural element from the NPD list: `Utsira High` (Utsirahøgda, 7.4.8) |
| Field/prospect | yes | no | `Volve` (NPD approved field names) |
| Quadrant/block | yes | no | `15/9` (arabic numerals, oblique, no leading zeros) |
| Licence | yes | no | `PL 046` (on the cover of the 1993 discovery evaluation report); confirm the current form against Sodir |
| Type of document | yes | no | see section 2 |
| Horizon | yes | label only | `Top Hugin Formation` style; informal names avoided |
| Map coverage | yes | no | UTM `6475411 N-6482362 N`, `430674 E-440082 E`, no leading zeros |
| Projection | yes | in subtitle | `UTM` |
| Central meridian | yes | no | `3°E` (zone 31) |
| Geodetic datum | yes | in subtitle | after conversion: `ETRS89`. The source is ED50 |
| **Vertical datum** | yes | `m below mean sea level, positive down` | verified: see [datum-check.md](datum-check.md). The Volve files themselves do not state it |
| Date approved | yes | no | ISO 8601 `YYYY-MM-DD` |
| Revision | yes | no | latest revision date |
| Scale | yes | no | a **scale bar** is mandatory, plus `1:25 000` style text when printed |

Optional (1.2.3): Reference ellipsoid (implicit once the datum is given), **Contour interval** (`10 m`, unit with SI abbreviation, `ms` for milliseconds), Included in report,
Enclosure no., Series no., Classification (public or not).

Also: a **legend** is expected unless irrelevant; a **location map** is preferable; revision and database (data sources) fields as needed. Dates are ISO 8601; multiple entries
in a field are separated by commas.

Our additions, which the standard has no field for: **Generalised** (smoothing method, width, mean and largest change from the source) and **Confidence**
(Observed, Derived or Interpreted, from SubScout). They stay, as extra rows, because the Volve terms require us not to present the data misleadingly.

## 4. Contours, highs and lows (1.3.1)

- **Major contour** and **minor contour** are drawn differently (heavier and lighter). We already draw every fifth line heavier.
- **Water depth contour** is a thinner line again. Relevant to the seabed horizon and any bathymetry basemap.
- **H** and **L** marks a closed high and low, in an oval. We do not draw these yet; they would come from the closure detection already latent in the contour polygons.
- **Isochron and isochore maps** mark depressions with hachured contours and a `>200` / `<200` style annotation. We do not draw these yet.
- Unconformities and erosional boundaries are a red wavy line (1.3.1, and `Erosion line` ff0000 in 6.26).

## 5. Faults (1.3.3, 6.26.1)

- **Normal fault**: drawn in map view as a line with short ticks to one side, with a matching block diagram; **reverse fault**: shown only as a block diagram with a heavy fault line. The standard
  does not spell out which side carries the ticks or any barb; the usual convention puts normal-fault ticks on the downthrown side.
- **Fault, uncertain position**: dashed line (two weights shown). **Displacement direction**: a half arrow. **Strike-slip**: paired opposite arrows.
- Colour: faults are **black** (`000000`) in structural element maps (6.26.1). The same table gives other boundaries their own colours: erosion line ff0000, continent-ocean boundary c500ff.
- The Volve fault sticks and polygons carry names only (`Volve_F52_2011`), not type or certainty. Until that is interpreted we can draw plain lines and the fault gaps in the surfaces,
  and must not invent a downthrown side. (Our gradient analysis can suggest it, not decide it.)

## 6. Wells and installations (chapter 3)

### 6.1 Definitions that drive the data model (3.1)

Hierarchy: borehole (shallow borehole 25 to 200 m below seabed; deep sea hole) and **well** (with a purpose: find, produce or inject hydrocarbons).
Well splits into **exploration well** (wildcat, appraisal) and **development well** (production, injection, observation), plus **test production well** and **subsea completed well**.
A **well track** is the path of one wellbore from kick-off to total depth. A **side track** that only bypasses an obstacle keeps the well name; a **deviated (side-drilled) well** to a new target gets a new drilling permit and the original name with a suffix `A`, `B`, `C`.

### 6.2 Well reference (3.2)

Seven parts: quadrant, block, type (blank = exploration, `A`-`P` = platform, `U` = shallow borehole, `T` = test production), number 1 to 99, history and configuration
(`A`.. sidetrack, `S` inclined exploration, `H` subsea completed, `R` reopened), well history (`2`.. reopenings, `X` junked for technical reasons), well track (`T2`..).
Examples: `31/2-5 S`, `30/9-B-25 H`, `31/2-5AR 2X`. Volve data uses `NO 15/9-A-15`, `NO 15/9-C-2 AH`, `NO 15/5-7 A` (country prefix and spaces), so the adapter parses these into
structured parts rather than keeping a string, and the wells module only ever sees the parts.

### 6.3 Symbols (3.4): shape first

**The system is compositional.** A well is a base circle, a layer per fluid (oil, gas, condensate, each proven, minor or trace; condensate has no trace form), a technical-status layer and a function layer. The standard's combination tables are a selection and say so ("other combinations may be made by following the same principle"), so SubScout stores layers and composes them, and the 50 selected examples are tests. Implemented in SubScout PR [#1](https://github.com/AdmcCarthy/SubScout/pull/1).

Shapes below are described from the rendered pages of the standard; check each against the PDF when drawing it.

The standard's well symbols are **black and white and carry the meaning in the shape**; colour (6.12) is secondary. This is the right model for us.

Three independent axes, combined:

1. **Technical status** (3.4.2): proposed (open circle), abandoned for technical reasons (circle with a cross), temporarily abandoned or shut in (circle with a horizontal bar), plugged and
   abandoned (circle with crosshair and vertical stem), mapped unit not observed (struck circle, with the codes `F` faulted, `NR` not reached, `NP` not present).
2. **Hydrocarbon status** (3.4.2): dry (open circle with side ticks), oil (filled circle), minor oil or uncertain producibility (half-filled), residual oil or traces (quarter segment), gas
   (sun burst), minor gas (open burst), condensate (four-lobed), minor condensate, residual gas or trace, coal. Combinations for several fluids in separate zones: oil and gas, oil and
   condensate, gas and condensate, oil/gas and condensate, and others "by the same principle" (3.4.3). Status applies to the well as a whole unless the legend says it applies
   to the mapped zone.
3. **Function** (3.4.4), drawn as an **overlay on the base symbol**: an arrow out to the north-east for production, an arrow in from the south-west for injection, a crossed circle for observation, a double ring for dual completion, a bar with a reason letter for shut-in, a pointer up or down for a zone above or below the mapped one. Cases: producing (letters `F` flowing, `P` pumping, `OBS` observation), dual completion (oil, gas, oil and gas), production by fluid (oil, gas, gas/condensate,
   water), relief well, shut-in with reason (`W` water, `R` repair, `G` gas-oil ratio, `S` sand, `E` exhausted), injection by fluid (water, gas, CO2, cuttings), converted well (producer
   to injector), zone specification (higher than, lower than, or exactly `R1`, `R2` for commingled). Planned production, water-injection and gas-injection wells have their own symbols.
   Users may define new letter codes if the legend defines them.

Further:

- **Trajectory** (3.4.5): solid line (well trajectory), dotted (approximate), dashed (planned). Surface location (open circle), position of a marker (with depth label such as `-2100 m MSL`),
  top reservoir, reservoir interval (thick), bottom hole position (end tick). Sidetracks from a vertical well, wells from a platform, planned drilling radius from a platform to a horizon.
- **Oriented dip readings** (3.4.6): from dipmeter, from core, at depth, in deviated wells.
- **Active exploration wells** (3.4.7): wildcat is a ring with a centre dot, appraisal a double ring.
- **Wells by general class** (3.4.9): development/service, exploratory, injector, non-hydrocarbon, shown as **coloured dots only** (the one place the standard relies on colour alone; SubScout adds a shape to each).
- **Installations** (3.5): 37 types plus a disused flare platform (38). The planned variant of each is **the same symbol in grey**, not a different shape, and a few carry fixed colours (platform red, anchor red, start/end point light blue, rig blue): anchor, buoys (general, loading, midline, STL, weather), CDU, clamp, clump weight, concrete block, crossing point,
  flange, flare platform (and disused), hang-off, junction, land valve station, manifold, pile, pipe connection, PLEM, PLET, platform, riser base, rig, ship, subsea template,
  subsea valve, tank, terminal or supply base, touchdown point, transponder, unknown.
- **Scale**: the symbol size and the use of indices (codes) should be adjusted to the map scale, and the codes used must be defined in the legend.

### 6.4 Hydrocarbon colours (6.12), for the optional colour layer

Oil `02db00` (green), gas `ff0000` (red), condensate `ffbee8` (pink), oil/gas (green and red), gas/condensate (red and pink), gas hydrates `b03f97`, hydrocarbons `ffcb05`,
unknown `6083a8`, CO2 `cdbd66`. Shows: proven oil `009900`, oil shows `00ff00`, oil traces `e6ffe6`, proven gas `ff0000`, gas shows `ff8080`, no shows `cccccc`, and others.

## 7. Colour (chapter 6)

- **6.18 scale for structure, isopach, isochore and isochron maps** is a 28-step rainbow, listed from `ff0357` (red-pink) through orange, yellow, green, cyan and blue to `e100ff`
  (magenta-violet). The table does not label which end is shallow. Convention puts the warm end on structural highs; to confirm with you.
- **6.4 water depth**: nine stepped blues, 0-200, 200-300, 300-500, 500-1000, 1000-1500, 1500-2000, 2000-2500, 2500-3000, over 3000 m (`9dd6ed` to `1728a6`). These classes suit the shelf and
  slope; Relief's finer shallow steps (0-20, 20-50, ...) suit coastal maps. For a basemap shown together with wells, prefer the standard.
- 6.26 structural elements, tectonic elements, domes, 6.14 block status and licences, 6.25 operator are fixed colour tables for basemaps.
- 6.27: OWC and GWC are dashed contact lines (black 1.5 pt with red 1 pt for oil-water, green for gas-water); seismic lines `0070ff`; well correlation `f05446`.

### Conflicts with SubScout and how we resolve them

| Geostandard | SubScout rule | Resolution |
|---|---|---|
| Rainbow scale for structure and thickness | one sequential ramp per quantity, lightness-ordered, CVD-checked | **Fjord stays the default** (your choice). Offer the standard scale as a named alternative, `geostandard`, for outputs that go to other companies, labelled as non-CVD-safe. Never silently |
| Oil green and gas red together | never red against green; direct-label | symbols are **shape-first**, so identification never relies on colour. Colour is an optional redundant layer, off by default; a `geostandard` colour set is available when exchange compliance is wanted |
| Black faults | tokens, no raw colours | use `--ss-text` (near-black in light, near-white in dark): same meaning, themeable |
| Hachure and half-arrow glyphs | no rule | follow the standard; draw as SVG, theme with tokens |
| Title box in any layout | fact strip | keep the fact strip, make its labels match the standard exactly where the standard requires them |

## 8. Gaps in the current viewer, ranked

1. **Vertical datum: resolved 2026-11-08.** The source files do not state it, so it was tested: horizon depth at 132 well picks on five surfaces against minus the pick's TVDSS gives
   median differences of -0.1 to 2.6 m, so the horizons are depth below mean sea level, positive down. The control (wells left in ED50 against ETRS89 grids) is clearly worse (Hugin top 36 m,
   base 72 m), so the check separates a datum from a position. A few picks on faults differ by 60 to 100 m. Method and numbers: [datum-check.md](datum-check.md), `scripts/check_datum.py`.
2. **Scale bar** (mandatory in the standard) and **location map** (preferable).
3. **Title-box fields** (section 3).
4. **H and L** marks, isochron hachures.
5. Standard map-type names in the heading.
6. Optional `geostandard` hydrocarbon colour set: **done for contacts** (oil green, gas red, the 6.27 contact-line style; off by default). The structure-map rainbow (6.18) is still not offered.

## 9. Open questions

- Is the standard's 6.18 scale red-for-shallow? (Not stated in the table.)
- Is "Area" for Volve `Utsira High` (the NPD list has Utsirahøgda) or a finer subdivision?
- Do you want the standard's terminology (Norwegian `Flateformkart, dyp`) available as a language option, or English only?
- Sodir attributes for the well-status and fluid mapping (purpose, status, content, development vs exploration tables) need checking against the FactPages tables before the adapter is written.
