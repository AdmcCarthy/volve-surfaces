# Contacts and structure: a plan to map closures, saddles and faults

Status: **plan and first evidence, 2026-11-08.** Nothing in the viewer has changed. The probe is `scripts/probes/structure_probe.py` (`uv run --with pillow python scripts/probes/structure_probe.py`); its numbers are quoted below and are rough (see the limits).

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
| Fault throw (78 top-Hugin polygons) | median 40 m; 10th to 90th percentile 14 to 82 m; 7 below 10 m, 18 between 10 and 30 m | About a third are minor (near or below seismic resolution at this depth). |
| Throw against reservoir thickness (median thickness 73.5 m) | 21 faults throw more than the thickness, 24 between half and one, 33 under half | A first, defensible seal split: reservoir against non-reservoir (candidate seal), partial, reservoir against reservoir (leaky unless smear). |
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
