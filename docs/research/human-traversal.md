# Research: human EVA traversal parameters

Researched 2026-09-25. **Key gap:** there is almost no measured data on suited walking at Mars gravity, and none on slopes. Every slope limit and walkback rule below comes from lunar experience or lunar requirements, so the planner must label them as assumptions for Mars. **UNVERIFIED** marks anything not confirmed from a source.

## Parameters

| # | Parameter | Value | Context | Source | Mars applicability |
|---|---|---|---|---|---|
| S1 | Suit slope capability | Walk up, down or across slopes ≤ 20°. Note: "Apollo 15 traversed on slopes of ~17°" | xEMU capability statement (lunar) | EVA-EXP-0042 Rev B §4.2.1.3 [1] | Lunar only; the Mars suit is "forward work" |
| S2 | CSRM no-go slope | Beyond ±20° excluded "per flight rules and requirements"; cross-slope listed as a possible addition | JSC planning tool, 5 m/px lunar DEM | Kim et al. ICES-2025-129 [2] | Demonstrated on a VR model of Jezero; threshold is lunar |
| S3 | Apollo slopes actually walked | < 15°, climbs up to 150 m. Crews over-estimated slopes (one guessed ~60°, measured < 30°) | Measured, suited, 1/6 g, 2 m DTM with 6 m baseline | Iqbal et al. EPSC 2024 [3] | Demonstrated envelope, not a limit |
| V1 | Apollo walkback planning | 3.6 km/h at 457 W (< 1 h); 2.7 km/h at 378 W (> 1 h); +20 % metabolic margin | Planning, suited, 1/6 g | Olthoff ICES-2018-259 [4] | Lunar |
| V2 | Apollo 14 EVA-2 speeds | Segments 1.4–5.7 km/h; loop 2.47 km/h; fit v = 2.97 − 0.078·S% with R² = 0.18 | Measured | [4] Table 5 | Slope explains little of the variation |
| V3 | Apollo-fitted speed | v [m/s] = −0.01·θ° + 0.75 | Apollo 12/14 fit | [2] eq. 2 | Sign convention unclear |
| V4 | SEXTANT piecewise speed | 1.6 m/s at 0°, 0.4 at +6°, 0.05 at +15–20°; 1.0 at −10°, 0.05 at −20° | Model | Johnson et al. 2010 [5] | Disagrees with V2/V3; treat speed as highly uncertain |
| V5 | Artemis planning pace | ~2 km/h on relatively level regolith | Planning | [1] | Lunar |
| V6 | Suited walking at simulated 3/8 g | Walk–run transition 1.54 ± 0.16 m/s; VO₂ 27.6–35.7 mL/kg/min at 1.07–1.53 m/s; subjects near peak aerobic capacity at ~1.5 m/s | MKIII suit, POGO rig, n = 6, level only | Norcross NASA/TP-2009-214796 [6] | The only suited Mars-gravity data found; pessimistic (heavy suit) |
| V7 | Optimal walking speed, unsuited | Mars 3.4 km/h vs Earth 5.5 km/h | Parabolic flight | Cavagna et al. 1998 (abstract only) | Upper bound |
| V8 | Slope → speed predictiveness | Poor; Tobler-type fits are "inadequate" for exploration traverses | Apollo; Earth analog | [3]; Goodwin et al. 2025 [7] | **Do not use Tobler for Mars** |
| M1 | Apollo 15 metabolic rate by terrain | Downhill 215 W, level 301 W, uphill 367 W (slopes ≤ 12°) | Measured | [4] | Lunar |
| M2 | Suited metabolic ranges | Apollo mean 980 BTU/h (max 2471). Heat-storage limit 500–2100 BTU/h | NASA-STD-3001 brief | OCHMO-TB-050 [8] | — |
| M3 | Simulated 10 km lunar walkback | 1.74 m/s, 95.8 min, 50.8 % of peak aerobic capacity | POGO 1/6 g | [6] | Lunar |
| M6 | SEXTANT metabolic model | W = (3.28m + 71.1)(0.661·v·cosθ + 0.115) + 3.5·m·g·v·sinθ (uphill) | Earth load-carriage equation + g | [5] | Not suit-calibrated |
| M7 | Minetti walking cost | Polynomial in grade i (1 g, unsuited) | Treadmill | Minetti 2002 [11] | **Do not transfer** |
| M8 | Walking on sand | 2.1–2.7× the energy of a hard surface | 1 g, unsuited | Lejeune 1998 [12] | Relative factor only |
| D1 | EVA duration | 6 ± 2 h (up to 8 h) + 1 h secondary O₂; crew not suited > 12 h | Suit capability | [1] | Lunar |
| D2 | Walking radius | ~2 km from the lander; ≤ 16 km total per EVA | ConOps | [1] | Lunar |
| D3 | Walkback rules | Unpressurized rover within a 5 h walk; on foot within a 1 h walk of the rover | ConOps | [1] | Lunar |
| D4 | Apollo walkback rule | Primary O₂ sized to reach the LM, keeping the 30 min OPS backup for ingress; line-of-sight distance | Flight rules | [4] | Method transfers |
| D5 | Timeline overrun | Apollo 14 took 25–30 % longer than 1 g training; 3 of 11 EVAs finished on time | Measured | NASA/TP-2017-219457 [13] | Use as a time margin |
| D6 | Mars DRA 5.0 | ~20 km walking range per suit charge; ~15 km walkback | Estimate | NASA-SP-2009-566 [14] | Mars; not a requirement |
| T1 | HiRISE DTM | Posts 1–2 m; vertical precision tens of cm; artifacts (boxes, seams, faceting) | Product documentation | [15] | Applicable |
| T2 | Kirk 2008 | Expected precision 0.19–0.22 m; RMS slopes 1.8–2.8° at a 1 m baseline | Peer-reviewed | [16] | Applicable |
| T4 | Rocks | Rocks > 1.5 m resolvable in HiRISE; smaller ones estimated with Fk(D) = k·exp[−q(k)·D] | Golombek 2012 [18] | — | Applicable |
| T5 | Loose-dust proxy | Thermal inertia < 100 with albedo > 0.25 → dusty, not trafficable | MSL engineering guide [19] | Rovers | Human use is an assumption |
| T6 | Slope baselines in rover practice | MSL < 30° at 2–5 m baselines; 2006 guide ≤ 15° over 5 m and 20–40 m | Requirements [19][20] | — | Always state the baseline |
| T7 | Slope algorithm | GDAL: Zevenbergen–Thorne for smooth terrain, Horn for rough terrain | [21] | — | — |

## Recommended defaults (adopted in PLAN §6.5)

- Horn slope with explicit baselines.
- Hard limit 20° (S, lunar; A for Mars).
- Bands 0–10 / 10–15 / 15–20°, plus a cross-slope penalty.
- Level speed v0 = 2.0 km/h, slope factor f = max(0.1, 1 − 0.0133·|θ|), timeline ×1.3.
- Sensitivity range across SEXTANT and Apollo 2.7 km/h.
- EVA 8 h cap / 6 h nominal.
- Walkback computed along the path, plus 0.5 h ingress; the secondary O₂ is never counted.
- 2 km radius warning.
- Hazard flags: thermal inertia < 100, micro-relief.
- A disclaimer listing the unresolved hazards.

## UNVERIFIED

- AxEMU slope specification.
- A claim of "2 km/h with < 1200 BTU/h".
- A 14 h NASA-STD-3001 figure.
- The Peña-Asensio 2024 sign convention.
- A Jezero rock-cover (CFA) estimate of 15–20 %.
- Jones 1998, Golombek 2008 and Cavagna 1998: seen as snippets only.
- THEMIS thermal-inertia resolution.
- The HIDH, not read directly.
- Carr & Newman numbers.
- The sand coefficient.
- Any suited slope walking at Mars gravity.

## References

1. https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf
2. https://ntrs.nasa.gov/api/citations/20250001829/downloads/ICES%202025%20TraverseModel.pdf
3. https://meetingorganizer.copernicus.org/EPSC2024/EPSC2024-196.html
4. https://ttu-ir.tdl.org/server/api/core/bitstreams/615c2ef2-d9ae-47b9-a347-70f73f19c1ef/content
5. https://web.mit.edu/aeroastro/www/people/dnewman/pdf2/DJN_AJohnsonSPACEAUG2010.pdf
6. https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2009-214796_EVA%20Walkback%20Test.pdf
7. https://research.manchester.ac.uk/en/publications/the-application-of-toblers-hiking-function-in-data-driven-travers/
8. https://www.nasa.gov/wp-content/uploads/2025/09/ochmo-tb-050-spacesuits.pdf
9. https://ntrs.nasa.gov/citations/20110003409
10. https://ntrs.nasa.gov/citations/20220009964
11. http://runscribe.com/wp-content/uploads/power/Minetti2002.pdf
12. Lejeune et al. 1998, J Exp Biol 201:2071 (via Europe PMC)
13. https://ntrs.nasa.gov/api/citations/20170007261/downloads/20170007261.pdf
14. https://www.nasa.gov/wp-content/uploads/2015/09/373665main_nasa-sp-2009-566.pdf
15. https://www.uahirise.org/dtm/about.php
16. https://pubs.usgs.gov/publication/70034779
17. https://astrogeology.usgs.gov/search/map/Mars/Mars2020/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40
18. http://www.marsjournal.org/contents/2012/0001/files/golombek_mars_2012_0001.pdf
19. https://marsoweb.nas.nasa.gov/landingsites/msl/memoranda/MSL_Eng_User_Guide_v2.pdf
20. https://pubs.usgs.gov/publication/70047380
21. https://gdal.org/en/stable/programs/gdaldem.html
