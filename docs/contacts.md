# Hydrocarbon contacts

The classical structure-map view: the part of a structure that holds each fluid, by contact, **per fault segment**, with the uncertainty shown. Built 2026-11-08 from the
Volve reports, the Sodir Geostandard, web sources and the `ep_geoscience_analytics` knowledge base (read only). Try it: the viewer's *Hydrocarbon contacts* control, and the
*Hydrocarbon contacts* section of the options page.

## 1. What was built

| Part | Where |
|---|---|
| Curated, cited contacts for Volve (every number carries its page) | `data/contacts/volve_curated.json` |
| Adapter: georeferences the digitised figure, converts to ETRS89, derives P90/P50/P10, checks contacts against the wells | `scripts/adapters/volve/contacts.py` -> `data/out/contacts.json` |
| Synthetic contacts: a gas cap over an oil leg, and two segments with different contacts, set below each trap's spill point | `scripts/synthetic.py` -> `data/synthetic/contacts.json` |
| The compute: seeded fill with an outline and barriers, open or closed, fluids by contact, probability of hydrocarbons | `site/js/surface/fill.js` |
| The layer (contract-conformant): fill, contact lines, hatched barriers, outline, wells with SubScout symbols, legend, facts, probe | `site/js/layers/contacts.js` |
| Viewer: contacts on or off, case, column colour (continuous or stepped), uncertainty (fade or none) | `site/js/host/viewer.js` |
| Options page: eight cards | `site/js/host/review.js` |
| Checks | `tests/test_contacts.py`; `scripts/smoke.py` (fill, probability and the layer contract in a browser) |

## 2. Decisions taken (yours, 2026-11-08)

1. **Fluid encoding: a continuous colour, with an option for a stepped colour bar.** The colour is the height of the column above the contact, in the fluid's own hue (oil ochre, gas red,
   SubScout tokens), continuous from pale at the contact to strong at the crest; *Stepped* quantises it into classes at an automatic round step. No hatch patterns.
2. **Digitise the Volve segment boundary and see how it goes.** Done, with limits (section 4).
3. **Uncertainty is a fade, and a hatched line for a barrier** between segments whose contacts cannot merge.

## 3. Terms

FWL (free water level, zero capillary pressure), OWC (oil-water contact, above the FWL by the entry-pressure height), GOC (set by the volume of gas, not capillarity), GWC, ODT and GDT
(oil or gas *down to*: a minimum, never a contact), spill point. Sources: [AAPG wiki](https://wiki.aapg.org/Special:MobileDiff/5865...27130), [AAPG wiki](https://wiki.aapg.org/Special:MobileDiff/5873),
`ep_geoscience_analytics/docs/pressure.md` and `config/pressure.yaml`. A different contact on the two sides of a fault shows the fault is a barrier
([AAPG wiki](https://wiki.aapg.org/Special:MobileDiff/6167)).

## 4. What the Volve documents say, and what we did with it

Depths are metres below mean sea level, positive down (verified, [datum-check.md](datum-check.md)). PUD is *Plan for utbygging og drift av Volve*, February 2005; the discovery
evaluation is the Statoil report on well 15/9-19 SR, December 1993.

| Statement | Where |
|---|---|
| **No contact has been penetrated**; an OWC significantly deeper than the base model's 3,120 m is possible | PUD printed p. 7 and p. 13 |
| Base-model OWC **3,120** (the most likely single value, "satt til 3120 m MHN") | PUD pp. 7, 13, 18, 21 |
| **A probability distribution of the OWC** from three weighted contact models: 3,105 (24 %), 3,120 (21 %), 3,135 (28 %), 3,170 (14 %), 3,260 (7 %), 3,330 (6 %); most likely 5 to 35 m below the oil-down-to in 15/9-19 A | PUD Table 3.5, p. 19 |
| Two non-communicating segments, north and south; the model's **"Dynamisk Barriere"** | PUD p. 21 and Figure 4.1, p. 22 |
| Wells: 15/9-19 SR oil 2,864 to 2,883; 15/9-19 A oil 3,013 to **3,101** (oil down to); 15/9-19 B(T2) in a segment outside the field, **water-filled**, from 3,149 | PUD Table 3.2, p. 18, and p. 7 |
| 1993: the OWC assumed to be the spill point, 2,945 (minimum 2,882, maximum 2,950); western and eastern segments | Discovery evaluation, printed pp. 11, 170, 171 |

From Table 3.5, the exceedance probabilities are 100 % to 3,105, 76 % at 3,120, 55 % at 3,135, 27 % at 3,170, 13 % at 3,260 and 6 % at 3,330 m: **P90 3,105, P50 3,135, P10 3,260, mean 3,150 m**
(oilfield convention: P90 is the low case). The base model (3,120) is at about P76.

**The 1993 contacts were wrong, and the display says so.** Well 15/9-19 A (drilled in 1996) found oil to 3,101 m, below even the 1993 maximum of 2,950 m. The 1993 case is kept, marked
*superseded* and *contradicted*; the north segment gets no fill, because its well is below every 1993 contact. The well in the segment outside the field is not used to test the field's contact.

### Digitising the barrier (the part that needed care)

Figure 4.1 is the PUD's reservoir model in plan view, with no coordinates. The barrier and the model outline were traced from it by eye and placed by **two well positions** (the Hugin top picks
of 15/9-19 SR and 15/9-19 A): a similarity transform of 9.23 m per pixel and 14.7 degrees of rotation (the model grid is visibly tilted). **Accuracy is about 250 m**, stated on the map.
Checks: the transformed active area lies on the fault-bounded Volve block and along the 3,120 m contour; 19A falls on the north-east side of the barrier and 19SR on the south-west, as the plan
describes; the outline is 5.7 km², and the PUD calls the field 2 x 3 km (p. 13).

A barrier alone does not isolate a segment: at 3,120 m the fill leaks out of the block between the fault polygons (8.4 km² connected, both wells in one body). The **outline** (the model's
active area, a convex hull of the figure's coloured cells) is the trap limit that stops the leak. With both, the fills separate: **4.1 km² south and 0.7 km² north** (map area, not volume).
The fill is then *held by the model outline* rather than closed by the surface, and the facts say so.

## 5. How the fill is computed

A segment is a seed (the well's Hugin top pick), a limit (the outline, when there is one) and barriers. The fill spreads from the seed through cells shallower than the deepest contact
(4-connected) and stops at nodata (fault heave in the surface), at the outline and at barriers. It is **open** where it reaches the survey edge: the display says so rather than drawing a
confident outline. A seed below every contact gives an empty segment. A fill never crosses into another segment's seed.

- **Fluid**: gas above the gas-oil contact, oil down to the oil-water contact; gas down to a gas-water contact if there is no oil leg.
- **Column**: height above the deepest base contact; the colour scale is shared by the segments.
- **Probability** that hydrocarbons are present at a depth = probability the contact is at least that deep: exceedance of the discrete contacts, interpolated between them (nothing below the
  last stated contact); for a min, likely, max range, a triangular distribution (an assumption, stated in the legend); for a single contact, 1 above and 0 below. The fill's opacity is that probability.
- **Lines**: each contact at its depth; with a distribution, P90, P50 and P10 dashed; with a range, min and max dashed; the gas-oil contact dash-dotted. Lines are clipped to their own segment's fill.
- **Barriers**: a hatched line (ticks both sides). **Wells that prove a fluid**: SubScout well symbols (oil: filled circle; water-bearing: the dry-well symbol).

## 6. What is approximate, and what is not covered

- The barrier and outline are digitised from a figure and placed by two wells: about 250 m. The P10 contact (3,260 m) lies outside the model outline, so its line is not drawn.
- Both Volve segments share the 3,120 m contact in the plan (it gives one OWC for the model); the plan does not say the segments have different contacts. Unequal contacts and a gas cap are shown on
  the synthetic data only.
- The OWC is drawn flat: no transition zone, no tilt (hydrodynamics), no FWL surface. Areas are map areas, not volumes.
- Contacts apply to the top-Hugin depth map; the control is disabled for other horizons and for time.
- **The Geostandard preset** (oil green, gas red from 6.12; contact lines black with a red dash for the OWC and a green dash for the GWC, 6.27) is built, **off by default** and flagged in the legend and facts as not
  colour-vision safe. The standard gives no style for the gas-oil contact, so that line keeps its own dash-dot. The colours come from the vendored SubScout symbol data, not from hex in this repo.
- Pressure-derived contacts (the FWL from formation pressure, as `ep_geoscience` does) need pressure data this repo does not hold.

## 7. Decisions taken (second round, 2026-11-08)

1. **The barrier line style lives in this repo.** This is the home of contour-based work for subsurface interpretation: surfaces, faults, barriers, contact lines and fills, and their line styles are owned here. SubScout keeps tokens and point symbols (wells, installations).
2. **The model outline as the trap limit is accepted** for the north and south segments. It stays an explicit, labelled assumption ("held by the model outline"), with the digitising accuracy stated.
3. **The Geostandard colour and contact-line preset is built**, off by default (the viewer's *Contact colours* control and two *G* cards on the options page).
