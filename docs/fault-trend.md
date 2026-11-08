# Fault trend and shading light

The shading light is placed across the dominant trend of the steepest gradients (`site/js/trend.js`), so scarps fall in shadow.

Method: gradient of a lightly smoothed surface (bridging nodata, because fault gaps hold the steepest ground), the steepest 0.5 % of cells,
weighted by gradient squared, doubled-angle mean for the axis (opposite-facing scarps reinforce), net facing from the signed mean, light from the
side the scarps face away from. Coherence below 0.15 falls back to a fixed north-west light and says so on the map.

## Validation

- **Synthetic** (true main fault strike N56°E, a second fault at N29°E with half the throw): detected N60 to 68°E, coherence 0.66 to 0.78.
  A tapered-throw cliff at the fault tips in an earlier generator showed up as a false strike, and was fixed; `tests/test_synthetic.py` keeps it honest.
- **Volve**, against the 66 interpreted fault sticks in `Volve_Official_Faults.dat` (length-weighted strike N30°E, coherence 0.21, the largest group
  N30 to 60°E at about 18 km of 50 km): BCU N22°E (coherence 0.54); Hugin top N52°E (0.30); Hugin base less stable (N55 to 82°E, coherence 0.10 to 0.27).
  Volve has several fault sets, so coherence is low; the map reports strike and coherence rather than hiding that.
- Fraction of steepest cells matters: 10 % pulls in dome flanks (synthetic gave N140°E), 0.5 % isolates faults. Revisit if the data change.
