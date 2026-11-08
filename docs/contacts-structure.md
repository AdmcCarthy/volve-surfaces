# Contacts and structure: closures, saddles and faults

Status: **steps 1 to 5 built, 2026-11-08** (the area-against-depth chart was added after steps 1 to 4; the robustness gates of step 6 are not built). The Volve fill the viewer draws by default has not changed: it is still the provided outline and barrier. Everything here is an **analysis layer** you switch on.

Decisions (yours, 2026-11-08): go with steps 1 and 2, then the 19BT2 test, up to step 4 but not 5. **Fault seal analysis is out of scope**: even small faults can be barriers to flow, and sealing depends on things outside this repository. So fault attributes here are measurements (throw, thickness, length, strike) and nothing in the code classes a fault as minor, leaky or sealing. The earlier idea of a "minor fault, never a barrier" class is dropped.

## 0. What was built

| Step | What | Where |
|---|---|---|
| 1 Closure engine | Merge tree of each depth grid: crests, relief, spill points (a saddle to a shallower high, or the edge of the data). Edge spills also report the saddle that would limit them if the edge were only the limit of mapping. Computed on the raw 25 m grid at build time. | `scripts/structure.py` -> `closures.json`; `site/js/layers/closures.js`; tests in `tests/test_structure.py` (analytic domes, noise, edge, fault gap) |
| 2 Fault attributes | Throw from a plane fitted either side of each fault (regional dip removed), thickness from top and base Hugin, throw over thickness, length, strike. Recovers the synthetic generator's throws within 5 m. Measurements, not a seal analysis. | `scripts/structure.py` -> `attrs` in `faults.json`; shown on hover and in the facts |
| 3 Wells and compartments | The existing provided segments keep their well limits; each water well now carries how it connects to the oil wells on the surface (`surface_connection`), with and without the fault polygons whose throw exceeds the thickness as walls. | `well_connections` in `structure.py` -> `contacts.json`; facts of the contacts layer |
| 4 Display tiers | Proven fill (provided limits, as before) and an optional **tentative** tier: what the surface alone would add at the base contact, faded with a dashed limit, never drawn by default. Closure outlines at the base contact (solid = closed by the surface, dashed = open at the data edge), spill markers with their depths. | viewer controls *Closure analysis* and *Tentative fill* |

Rebuild: `uv run python scripts/structure.py` (after `adapters.volve.contacts`, which rewrites `contacts.json`). The scratch probes are `scripts/probes/`.

## 1. The problem

Today a contact fill is a flood from a well through cells shallower than the contact, stopped by nodata, a digitised outline and a digitised barrier ([contacts.md](contacts.md) section 5). That is robust only because a person drew the outline and the barrier. Without them the surface alone **over-fills**. What we want is to understand the structure well enough to say: which highs and saddles a contact reaches, which faults hold it, which wells prove or limit it, and what is only tentative.

## 2. Vocabulary (how the contact meets the structure)

- **Structural high**: a local minimum of depth (a crest). A **closure** is the area shallower than a contour that closes around the crest.
- **Saddle**: the shallowest pass between two highs. **Spill point**: the saddle at which a closure stops being closed: fill the trap deeper than that and the hydrocarbons spill to the neighbour. A **4-way closure** is closed by dip on all sides, without a fault; a **fault-dependent** closure needs a fault to seal one side.
- **Merge tree** (the right tool): sort cells shallow to deep, join neighbours, and record each time two highs meet. Each merge is a saddle depth; the deeper high's closure ends there. Reading the tree at a contact depth gives, for every high, whether it is its own closure or part of a bigger one. This is deterministic and cheap on a 415 x 285 grid.
- A contact deeper than a saddle means the two highs share it **if they are in communication**. Whether they are is a geological claim (no sealing fault between, charge reached both), so that part is **tentative** by nature.

## 3. What the Volve data say (probe, top Hugin, depth)

| Finding | Number | So what |
|---|---|---|
| Surface alone at 3,120 m (no outline, no barrier) | one 8.4 km² component holds 19SR and 19A | The PUD field is about 2 x 3 km and our outlined segments total 4.8 km²: the surface alone adds roughly 3.6 km² of satellite highs. |
| Spill of the Volve high | **3,133 m**, at E 436350 N 6477725 | The base-model OWC (3,120) is 13 m above the spill and the P50 (3,135) is **at** it. Below 3,133 the surface no longer closes the trap; at 3,135 the connected area jumps from 8.4 to 19.7 km². The P10 (3,260) cannot be held by this surface: the outline is doing that. |
| Satellite high south-west | crest 2,990 m, saddle 3,072 m, 82 m relief | At 3,120 m it floods, tentatively, with the main high. A clear example of "bigger closure filled by the contact". |
| Fault control of the 3,120 m contour | 52 % of its length lies against a fault polygon, 37 % against nodata | The closure is mostly fault-limited: fault seal is first order, not a detail. |
| Fault throw (77 measured top-Hugin polygons, dip removed) | median 23 m; 10th to 90th percentile 5 to 66 m; 21 below 10 m, 23 between 10 and 30 m, 33 at 30 m or more | Many faults are small. That says nothing about whether they seal: any may hold or pass fluid. |
| Throw against reservoir thickness (median thickness 73.5 m) | 12 faults throw more than the thickness, 18 between half and one, 47 under half | A juxtaposition indicator only (reservoir against non-reservoir at the fault). It is shown, and used as an optional wall in one test, never as a seal call. |
| Water well 19BT2 | top Hugin 3,137 m, water; 400 m from the 3,133 m saddle, and **the saddle is not in a fault polygon** | If it were in communication the OWC would be at or above 3,137 m, which half of the PUD distribution contradicts. The PUD says it is a separate segment, so a barrier exists that our polygons do not show here. Either a minor fault the polygons miss, or a barrier that is not structural. This is the single most useful thing to resolve. |

Limits of the probe: throw is a median difference across a ring either side of a polygon along its principal axis (dip contaminates it); nodata in the grid is fault heave plus survey edge; saddles are on the generalised 25 m grid; no volumes. The numbers say where to look, they do not decide.

## 4. Proposed method (in order, each step shippable)

1. **Closure engine** (`site/js/surface/closures.js`, tested on synthetic data with known truth). The merge tree gives, per high: crest, relief, spill depth and place, and the neighbour it spills to. Nodata gaps narrower than a fault heave are bridged for connectivity only (as the open/closed test does now), never for values. Output feeds a list of closures and a "closure at depth d" polygon set.
2. **Fault attribution** (build step, `scripts/adapters/volve/faults.py`). For each polygon: throw from the surface on either side, thickness from top and base Hugin, throw over thickness, length, and a class: *major* (above thickness), *partial*, *minor* (below about 10 to 15 m, never a barrier). Candidate barriers are a **suggestion, labelled Derived**; anything in the curated record (the digitised barrier) stays **Interpreted** and wins.
3. **Compartments and wells.** Cut the closure area by candidate seals into compartments. Each well constrains its compartment: oil-down-to is a minimum contact, a water top is a maximum; two wells in one compartment with incompatible evidence are flagged, not hidden. A compartment with no well gets no fill unless it is tied to a proven compartment by a saddle below the contact (then it is **tentative**).
4. **Display tiers.** Proven (a well is in the filled compartment): full colour. Tentative (reached through a saddle or across a minor fault, no well): the fade used for uncertainty plus a dashed limit, and the legend says why. Not filled: nothing. Spill points are marked (a small symbol and its depth); minor faults are drawn thin and never as barriers.
5. **Area against depth chart** per compartment (the closure's hypsometric curve) with the contacts, the well evidence and the spill depths marked. It shows at a glance that 3,135 m is the spill.
6. **Gates** (what makes this "robust", section 5).

## 5. Robustness gates, and the fallback you asked for

Ship the structural fill as the default only if it passes **all** of these; otherwise keep the fallback.

- On synthetic data (known contacts, spill points and faults) it recovers the true fill within 5 % of area and finds the true spill depth to within one cell's relief.
- On Volve, with the digitised outline and barrier removed, it either reproduces the provided polygons within 15 % of area or **explains** the difference (named satellites, named fault gaps). It must not silently exceed them.
- Stable under the choices we do not control: smoothing detail (Raw to Medium), gap bridging (0 to 4 cells), the 250 m digitising error, the minor-fault threshold (10 to 15 m). A fill that changes by more than 20 % across those is reported as unstable and not drawn as proven.
- Every extension beyond a provided polygon is labelled tentative and carries its reason.

**Fallback (recommended as the default now): map the hydrocarbon-water contact only inside provided polygons.** That is the current behaviour: accumulation outline plus barrier, per segment, contact lines clipped to the polygon, wells as evidence. It is robust because a person owns the limit. The structural analysis then adds *information* (spill points, satellites, candidate faults, the area-depth chart) without changing the provided fill, until the gates pass.

## 6. Suggestion

1. Keep provided polygons as the default fill. Do not let the surface extend it yet.
2. Build steps 1 and 2 first (closure engine and fault attribution), show them as an **analysis overlay** (spill points, closure outlines at a chosen contact, fault classes), and use the synthetic truth to test.
3. Use the 19BT2 puzzle as the first real test: find what separates it from the Volve high and whether our fault polygons show it. The result decides how much trust the fault classes deserve.
4. Only then add compartments, wells as limits and the tentative tier (steps 3 and 4).

Open points for you: whether "minor" should mean below 10 or 15 m throw; whether tentative extensions should draw at all in the default view (my suggestion: only in the analysis overlay); and whether we may read the PUD pressure data for the 19BT2 separation (it is not in this repo).

## 7. Results of the first build

**Closures (top Hugin, depth).** The Volve high (H3, crest 2,802 m, relief 187 m) is **open at the edge of the data at 2,990 m**: the interpreted surface ends at the south-west before the closure closes. If that edge is treated as only the limit of mapping, the saddle that limits it is at **3,133 m** (so the earlier "spill at 3,133" holds only on that assumption). The three shallower neighbours (H4, H5, H7) are small saddle-limited satellites with 28, 14 and 33 m of relief. At the base contact (3,120 m) the surface-connected area is 8.4 km² and it is open at the data edge, so **the PUD's contacts below about 2,990 m are not closed by the data on their own**: the model outline and the barrier are doing real work, which is why the provided limits stay the default.

**Tentative tier.** Removing the outline and barriers adds 3.5 km² at the base contact (8.4 km² against the 4.8 km² provided), open at the data edge, with no well in it.

**The 19BT2 test.** Question: what separates the water well from the Volve high?

- On the grid 19BT2 (top Hugin 3,146 m) is connected to both oil wells through a pass at its own depth: it sits on the flank of the high. Fault gaps as walls or bridged give the same answer.
- The path to 19A runs 15 cells **inside the heave polygon of fault 68** (throw about 111 m, 1.3 times the Hugin thickness). A heave area in the grid is interpolated, so that connection is not evidence of communication.
- Treating the polygons whose throw exceeds the thickness as walls (fault 68 is the one that matters; the result is identical for 68 alone) moves the pass from **3,146 m to 3,186 m**. Treating every polygon as a wall disconnects BT2 from both oil wells.
- Reading: a contact down to 3,146 m needs no barrier (the base case, 3,120 m, does not reach the well). A contact between 3,146 and 3,186 m is compatible with BT2 being water only if something outside the grid separates them; beyond 3,186 m the surface connects them around fault 68. In the PUD distribution about 47 % of cases are deeper than 3,146 m and about a quarter deeper than 3,186 m. **Fault 68 is the candidate separating element**, consistent with the PUD calling BT2 a separate segment, but this is a juxtaposition indicator, not a seal analysis, and the digitised barrier (161 m away) is not the thing that separates them.
- The two oil wells connect to each other on the surface at 3,010 m: below that the digitised barrier is what keeps the north and south segments apart.

## 8. Area against depth (step 5), and what is not built

Built: one chart per closure (up to six, the highest relief first) under the map when *Closure analysis* is on: the map area of the connected closure at each contact depth, from the crest to 40 m below its deepest spill, computed by a priority flood on the raw grid (`basin_curve` in `scripts/structure.py`, stored as `curve` in `closures.json`; `site/js/host/areachart.js`). Marked on it: the spill (solid), the spill if the data edge is a limit (dotted), the contacts of the case on show with P90, P50 and P10, and the wells in the closure (oil down to, water top). A jump in the curve is a merge with a neighbouring high; the Volve high's curve jumps at its 3,133 m saddle, and the 19BT2 water top (3,146 m) sits just after it. Map area, not volume. The charts are not in the PNG export yet.

Not built: the robustness gates of section 5. That section stays the standard to meet before the tentative tier is allowed to extend the default fill.
