# Hydrocarbon contacts

The classical structure-map view: contours of a reservoir top, with the part of the structure that holds each fluid shown by its contact, **per fault segment**,
because a segment can have its own contact. This note is the design for it. Nothing here is built yet; the choices that need you are at the end.
Written 2026-11-08 from the Volve reports, the `ep_geoscience_analytics` knowledge base (read only), the Sodir Geostandard and web sources.

## 1. What the display is for

1. Show **where the fluids are**: gas above the gas-oil contact, oil between it and the oil-water contact, water below, on the top-reservoir map.
2. Show **how sure we are**: a contact is an interpretation (often an assumption, such as "filled to the spill point"), so minimum, most likely and maximum
   contacts are three lines and two fills, never one confident line.
3. Show **segments**: a contact at a different level across a fault means the fault is a fluid barrier ([AAPG wiki](https://wiki.aapg.org/Special:MobileDiff/6167),
   [Elsevier, Reservoir Characterization ch. 12](https://booksite.elsevier.com/9780444528186/htm/reschar_chapter_12/figure_12_28.htm)). Different contacts in neighbouring
   blocks is the evidence, so the map must be able to carry one contact per segment.
4. Give **the column**: the vertical height of hydrocarbons above the contact, as a map (the standard names it, section 5).

## 2. Terms (and where each meaning comes from)

| Term | Meaning | Source |
|---|---|---|
| **FWL**, free water level | the level where capillary pressure is zero: oil and water pressures are equal. Read from pressure-depth data, not from logs | [AAPG wiki](https://wiki.aapg.org/Special:MobileDiff/5865...27130); `ep_geoscience_analytics/docs/pressure.md` (free water level section) |
| **OWC**, oil-water contact (also HWC, hydrocarbon-water contact) | the lowest level of mobile oil; it lies **above the FWL** by the height the rock's entry pressure holds up, so FWL and OWC are different surfaces | same; ep_geoscience `contact_above_fwl_m` |
| **GOC**, gas-oil contact | where gas gives way to oil. Controlled by the **volume of gas in the trap**, not by capillary properties | [AAPG wiki](https://wiki.aapg.org/Special:MobileDiff/5873) |
| **GWC**, gas-water contact | the base of a gas-only column | ep_geoscience `config/pressure.yaml` `contact_labels` |
| **ODT / GDT**, oil / gas down to | the deepest oil or gas **seen**: the contact is at or below it, so it gives a **minimum column**, never a contact | ep_geoscience `config/pressure.yaml` (`down_to`), docs/pressure.md (buoyancy section) |
| **Transition zone** | the interval between the OWC and the level of irreducible water: water and oil both present | [AAPG wiki](https://wiki.aapg.org/Special:MobileDiff/822) |
| **Spill point** | the lowest level at which the trap holds hydrocarbons; closure is the height from crest to spill point | traps lecture notes, [W. Oregon Univ.](https://people.wou.edu/~taylors/es486_petro/7_Traps_Seals.pdf) |

Two consequences for the model: a contact has a **kind** and a **basis** (stated, assumed, measured in a well, from pressure, "down to"), and a *minimum* contact (ODT, GDT,
base of a penetrated reservoir) is drawn differently from a contact. A contact **below the spill point** means stratigraphic influence ([UKCS note](https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/367288/stratigraphic_plays_UKCS.pdf)),
so spill is a limit to display, not an upper bound to enforce.

## 3. What the Volve documents say (a worked case)

Both statements are about the Hugin Formation reservoir of the Volve (Theta Vest) structure. Depths are metres below mean sea level, positive down, the same datum as our horizons
(verified, [datum-check.md](datum-check.md)).

| Stage | Statement | Where |
|---|---|---|
| 1993 discovery evaluation | the oil-water contact is **assumed to be the spill point** of the structure: resource estimate "based on the assumption that the oil-water contact is governed by the spill point" | Discovery evaluation report, well 15/9-19 SR (Statoil, Dec. 1993), printed p. 11 (PDF 15) |
| 1993 | well **15/9-19 SR** found the reservoir full of oil: top **2864**, base **2882**, a proven column of **18 m**; **no contact was penetrated** ("it has not been possible to determine any fluid contact(s)") | printed p. 169 to 170 (PDF 173 to 174) |
| 1993 minimum case | the base of the reservoir at **2882** could be the most shallow contact; with the structure top at 2754, a minimum oil column of **128 m** | printed p. 170 |
| 1993 base case | the structure is filled to its spill point at **2945**, and that equals the OWC: an oil column of **191 m** | printed p. 170 |
| 1993 maximum | five metres added for spill-point mapping uncertainty: contact at **2950**, a maximum column of **196 m** | printed p. 170 |
| 1993 segments | the Theta Vest structure is divided into a **western** segment (contains 15/9-19 SR, proven, highest point 2790) and an **eastern** segment (not proved, highest point 2754) | printed p. 171 (PDF 175) |
| 1993 | "the presence of sealing faults may define fluid contacts deeper than the mapped spill points" | printed p. 161 (PDF 165) |
| 2005 plan for development and operation (PUD) | top of the Volve reservoir **2750**; the oil-water contact is **set to 3120**; the reservoir is split into **two non-communicating segments, north and south**, from fluid properties and test results | PUD section 4.1, p. 21 |

The contact moved **175 m deeper** between the 1993 discovery evaluation (spill point, 2945) and the development plan (3120), and the segmentation changed from west and east to north and south.
That is the display's job in one example: the same surface, three contacts (minimum, most likely, maximum) in 1993 and one set value in 2005, and a segment boundary that is an
interpretation. The PUD and the discovery report do not give the segment boundary as geometry; it would have to be digitised from their figures, or chosen by you.

**How much the contact matters here** (computed on the Hugin top grid in this repo, a 25 m cell, fault gaps blocking connection; the area of cells shallower than the contact, over
all highs, not a volume): 4.3 km² at 2882, 7.1 km² at 2945, 7.3 km² at 2950 and **18.7 km² at 3120**, out of 28.7 km² of surface. The shallowest point of this grid (2725 m) is on
a high at the eastern edge that continues off the data, not on Volve's own dome. So a contact cannot be applied to "the structure" by filling from the crest: **it needs a seed per
segment** (see section 5).

## 4. Data model

One record per contact statement, kept apart from the surface (a contact is not a property of the grid):

```
contact { id, kind: "OWC" | "GOC" | "GWC" | "FWL" | "ODT" | "GDT",
          depth, unit: "m", datum: "MSL, positive down",   // same as the horizons; adapters convert (the well files give TVDSS, negative down)
          segment: <id> | null,                             // null = applies to the whole accumulation
          reservoir: "hugin",                               // the horizon the contact belongs to
          range: { min, likely, max } | null,               // draw three lines and two fills
          basis: "stated" | "assumed-spill" | "assumed-minimum" | "measured-in-well" | "from-pressure",
          confidence: "Observed" | "Derived" | "Interpreted",   // SubScout's three levels
          well: "NO 15/9-19 SR" | null,                     // the well that proves it, when there is one
          source: "Discovery evaluation report (1993), p. 170", date: "1993" }
segment { id, name, seed: [x, y] | well: <id>,              // where the fill starts: a well penetration or a digitised point
          barrier: <fault ids> | "gaps",                    // what stops the fill: sealing faults, or the nodata gaps in the surface
          note }
```

The contacts file is a **curated, cited JSON** (like `data/out/faults.json`, EPSG:25831) and a test requires every contact to carry its source and page. Sodir and the `ep_geoscience`
well-history contact marts (`well_contact_tvdss`, with basis) can feed the same record later; they hold no Volve wells today, so for Volve the reports are the source. Note the
name clash: `ep_geoscience` calls formation boundaries in a well `well_contact` as well; ours are always *fluid* contacts.

## 5. Computing the fill

1. **Seed and barriers.** A fill starts at a segment's seed and spreads through neighbouring cells shallower than the contact (4-connected). The nodata gaps in the surface (fault
   heave) block it, so a fault that cuts across the structure bounds the segment without any extra data; a fault that ends leaves a leak, which is honest: the leak is where the
   interpretation says the fault does not seal. Extra barriers (a sealing fault drawn through a leak) are explicit records, never guessed.
2. **Open or closed.** A fill that reaches the survey edge is **open**: the trap is not closed within the data, and the display says so instead of drawing a confident outline.
3. **Fluids by contact.** For one segment: gas where depth is above the GOC (or the GWC if there is no oil leg); oil between the GOC and the OWC; with only an OWC, oil above it.
   A dual-phase accumulation needs the GOC and the OWC; a gas-only one the GWC. The FWL is shown only if given, as a separate dashed line (it is not the OWC).
4. **ODT and GDT** draw a hatched minimum fill with the contact line absent: the real contact is at or below.
5. **The column**: height of hydrocarbons above the contact, `contact depth minus top depth`, inside the fill. This is the standard's *gross reservoir thickness map for oil/gas*.
6. **Uncertainty**: compute the fill at minimum, likely and maximum; draw the likely fill solid, the extra area to the maximum lighter, and three contact lines.
7. **Time surfaces** are not filled: a contact is a depth, and mixing it into a time map needs a depth conversion we do not have. The control is disabled for TWT.

## 6. The Geostandard

- **Map types** (7.1, 1.1.6): *Hydrocarbon area map* (the extent of hydrocarbons at top reservoir), *Hydrocarbon column map*, *Gross* and *Net reservoir thickness map for oil/gas*.
  The title box's "Type of document" should use these names.
- **Contact line styles** (6.27): the OWC is a dashed line, black 1.5 pt with a red 1 pt dash on top; the GWC the same with green. These are the standard's; they sit on the same
  colour-vision problem as oil-green and gas-red (6.12), so they are a preset (below), not the default.
- **Hydrocarbon colours** (6.12): oil `02db00`, gas `ff0000`, condensate `ffbee8`, oil/gas two-colour. Shows: proven oil `009900`, oil shows `00ff00`, no shows `cccccc`.

## 7. Display options for the options page

SubScout's rules apply: fluid is never identified by colour alone, and the depth fill stays Fjord. So the fluid encoding is **pattern and line style first, a colour tint second**.

| Option | What it shows |
|---|---|
| A. Contact line only | a heavy line at the contact depth inside the segment, labelled with kind and depth; the depth fill unchanged |
| B. Fluid fill, one phase | a transparent tint and a hatch inside the oil fill; outside it the depth fill alone |
| C. Gas cap and oil leg | two hatches: dots for gas, diagonal lines for oil; GOC and OWC lines between them |
| D. Segments | the same map with a different contact per segment, the boundary drawn, each contact labelled |
| E. Column map | the column height as a sequential map inside the fill, over a muted depth fill |
| F. Uncertainty | minimum, likely and maximum contact lines and a lighter band between them |
| G. Standard colours | A to F with the Geostandard colours and contact-line styles, off by default and flagged as not colour-vision safe |

Volve cases to draw: the 1993 minimum, base and maximum contacts (2882, 2945, 2950) for F; the 2005 OWC at 3120 for A, B and E; two segments (north and south, boundary to be
digitised) for D. The synthetic set can show a gas cap with an oil leg and two segments with different contacts, which Volve cannot (it is single-phase in the documents we have).

## 8. Where it lives (modules)

- `site/js/surface/fill.js`: the compute (flood fill from seeds with barriers, open or closed, fluids by contact, column). No drawing, no Volve.
- `site/js/layers/contacts.js`: a layer meeting the contract: fill, contact lines, legend entries, title-box rows (type of document, contacts with basis and source), probe.
- `scripts/adapters/volve/contacts.py`: reads the curated, cited JSON, validates it and writes `data/out/contacts.json` (no CRS conversion: depths only; the seeds are converted).
- SubScout: the hatch patterns and contact line styles are symbology, so they belong in `styleguide/` and `symbols.toml` (a follow-up to PR #1), not here.

## 9. Not covered, and why

- **Volumetrics.** Areas here are map areas; a volume needs the reservoir thickness, net-to-gross and the fluid properties.
- **Transition zones and the FWL as a surface.** The OWC is drawn flat; a transition zone and a tilted contact (hydrodynamics; the `ep_geoscience` rules flag it as a tilt, not an error) are noted
  as limits, not drawn.
- **Pressure-derived contacts.** `ep_geoscience` derives the FWL from pressure-depth data. For Volve that needs the formation-pressure data, which this repo does not hold.
- **Time-domain contacts.**

## 10. Decisions for you

1. **Fluid encoding.** Pattern and line style with a quiet tint (dots for gas, diagonals for oil), as in section 7, or a stronger tint? And is the Geostandard colour preset worth having?
2. **Seeds and segments for Volve.** The reports give two segment pairs but no geometry. Shall I digitise the north and south boundary from the PUD figures (needs your check), take it from
   one of the interpreted faults (which?), or ship the contact without segments first?
3. **Which contact is "the" Volve contact?** The 2005 PUD value (3120) is the development case; the 1993 values are the earlier evaluation. I would show all as separate, dated records, with
   3120 as the default and the 1993 range as the uncertainty example. Agreed?
4. **Where to start.** A, B and E on the Hugin top with the 2005 contact need only the seed (15/9-19 SR) and are small. C, D and F need more. Build A, B, E first?
