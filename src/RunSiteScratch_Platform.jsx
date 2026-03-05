import { useState, useRef, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════
// RUNSITESCRATCH — FULL PLATFORM
// Landing + Intake + Forecast Engine + Results Dashboard
// Design: Pure black/white monochrome
// ═══════════════════════════════════════════════════════════════

// ─── SESSION 15: CALIBRATION FUNCTIONS ──────────────────────
// Range-based fuel/merch/food calibration (position-scaled, income-adjusted)

function s15FuelRange(fd) {
  const positions = +(fd.fuelPositions || fd.gasPositions) || 8;
  const mhi = +(fd.medianIncome) || 65000;
  const hours = fd.operatingHours || fd.hours || '24hr';
  const BASE = 14625; // 117K / 8 positions
  const posBaseline = positions * BASE;
  let mm = 1.0;
  if (mhi < 45000) mm *= 0.85; else if (mhi < 55000) mm *= 0.90;
  else if (mhi < 65000) mm *= 0.94; else if (mhi < 80000) mm *= 1.00;
  else if (mhi < 100000) mm *= 1.04; else if (mhi < 130000) mm *= 1.07; else mm *= 1.10;
  const is24 = hours === '24hr' || /24/.test(hours);
  const isExt = /extended|20|21|22/.test(hours);
  if (!is24 && isExt) mm *= 0.90; else if (!is24) mm *= 0.82;
  const access = (fd.cornerPosition || '').toLowerCase();
  if (/signalized|hard corner|traffic light/.test(access)) mm *= 1.05;
  else if (/secondary|side street|rear/.test(access)) mm *= 0.90;
  const mid = Math.round(posBaseline * mm);
  return { floor: Math.round(mid * 0.72), mid, ceiling: Math.round(mid * 1.15) };
}

function s15MerchRange(fd) {
  const sqft = +(fd.storeSqft) || 3200;
  const mhi = +(fd.medianIncome) || 65000;
  const hasFood = fd.foodservice && fd.foodservice !== 'none';
  const isKitchen = hasFood && fd.foodservice !== 'roller_grill';
  const NACS_TOTAL = 170000;
  const foodPct = isKitchen ? 0.25 : 0.08;
  const MERCH = Math.round(NACS_TOTAL * (1 - foodPct));
  const sqMult = Math.pow(sqft / 2675, 0.55);
  let im = 1.0;
  if (mhi < 45000) im = 0.80; else if (mhi < 55000) im = 0.87;
  else if (mhi < 65000) im = 0.93; else if (mhi < 80000) im = 1.00;
  else if (mhi < 100000) im = 1.06; else if (mhi < 130000) im = 1.11; else im = 1.15;
  const adj = Math.round(MERCH * sqMult * im);
  return { floor: Math.round(adj * 0.65), mid: adj, ceiling: Math.round(adj * 1.25) };
}

function s15FoodRange(fd) {
  const kt = fd.foodservice || 'none';
  if (kt === 'none') return null;
  const mhi = +(fd.medianIncome) || 65000;
  const ceilings = {
    roller_grill: [3000, 7000], hot_express: [7000, 14000], basic: [7000, 14000],
    kitchen: [20000, 41000], full_kitchen: [20000, 41000], branded: [37000, 51000], pizza: [12000, 25000],
  };
  const [fb, cb] = ceilings[kt] || ceilings['kitchen'];
  let ia = 1.0;
  if (mhi < 45000) ia = 0.65; else if (mhi < 55000) ia = 0.75;
  else if (mhi < 65000) ia = 0.82; else if (mhi < 80000) ia = 1.00;
  else if (mhi < 100000) ia = 1.05; else ia = 1.10;
  return { floor: Math.round(fb * Math.max(ia, 0.80)), ceiling: Math.round(cb * ia) };
}

function clampVal(val, floor, ceiling) { return Math.max(floor, Math.min(val, ceiling)); }

// ─── FORECAST ENGINE (embedded) ──────────────────────────────

const DENSITY_CLASS_CENTROIDS = {
  1: { label:'Super Urban', popMed:20000, hhMed:10000, aadtMed:50000, vehMed:12000, tradeRadius:0.75 },
  2: { label:'Urban', popMed:11787, hhMed:5815, aadtMed:42654, vehMed:6981, tradeRadius:1.0 },
  3: { label:'Light Urban', popMed:15444, hhMed:7795, aadtMed:29935, vehMed:10973, tradeRadius:1.25 },
  4: { label:'Suburban', popMed:8351, hhMed:3380, aadtMed:31740, vehMed:5331, tradeRadius:1.5 },
  5: { label:'Light Suburban', popMed:11223, hhMed:4210, aadtMed:29752, vehMed:7377, tradeRadius:1.75 },
  6: { label:'Exurban', popMed:5367, hhMed:1946, aadtMed:18030, vehMed:3707, tradeRadius:1.75 },
  7: { label:'Rural', popMed:2413, hhMed:888, aadtMed:10584, vehMed:1836, tradeRadius:3.0 },
};

const DC_CAPTURE = {
  1: { table: 0.007, med: 0.0050, low: 0.0020, high: 0.0120 },
  2: { table: 0.010, med: 0.0071, low: 0.0024, high: 0.0184 },
  3: { table: 0.010, med: 0.0090, low: 0.0032, high: 0.0830 },
  4: { table: 0.016, med: 0.0093, low: 0.0015, high: 0.0990 },
  5: { table: 0.018, med: 0.0115, low: 0.0020, high: 0.0960 },
  6: { table: 0.025, med: 0.0154, low: 0.0019, high: 0.1158 },
  7: { table: 0.035, med: 0.0226, low: 0.0033, high: 0.1656 },
};

const DC_DIESEL_PCT = { 1:0.02, 2:0.027, 3:0.062, 4:0.066, 5:0.069, 6:0.075, 7:0.109 };
const DC_TRUCK_PCT = { 1:0.03, 2:0.043, 3:0.030, 4:0.050, 5:0.055, 6:0.075, 7:0.100 };
const DC_FUEL_GAL = { 1:90000, 2:94250, 3:82000, 4:85000, 5:95000, 6:82558, 7:79000 };
const DC_INCOME_MED = { 1:85000, 2:73828, 3:92226, 4:59062, 5:68358, 6:64952, 7:57825 };

const HSD = { longHaul: 108, shortHaul: 77, longPct: 0.65, shortPct: 0.35, weighted: 97.15 };
const NACS = {
  Q4: { gal:101179, inside:110932, insideGP:32809, opex:40744, sqFt:2818, perSqFt:39.39, poolCPG:26.31 },
  Q3: { gal:100580, inside:155465, insideGP:52159, opex:45384, sqFt:2915, perSqFt:53.33, poolCPG:34.08 },
  Q2: { gal:98100,  inside:143974, insideGP:48645, opex:51137, sqFt:2799, perSqFt:51.44, poolCPG:36.56 },
  Q1: { gal:181331, inside:250353, insideGP:88226, opex:83196, sqFt:3531, perSqFt:70.99, poolCPG:36.38 },
};

function classifyDensity(pop, hh, aadt) {
  const R = { pop:44949, hh:18369, aadt:284640 };
  let best = 6, bestD = Infinity, second = 6;
  for (const [dc, c] of Object.entries(DENSITY_CLASS_CENTROIDS)) {
    const d = 4*Math.abs(pop-c.popMed)/R.pop + 4*Math.abs(hh-c.hhMed)/R.hh + 1.5*Math.abs(aadt-c.aadtMed)/R.aadt;
    if (d < bestD) { second = best; bestD = d; best = +dc; }
  }
  const gap = bestD > 0 ? 1 : 0;
  return { dc: best, label: DENSITY_CLASS_CENTROIDS[best].label, alt: second, altLabel: DENSITY_CLASS_CENTROIDS[second]?.label, confidence: bestD < 0.3 ? 'high' : bestD < 0.6 ? 'moderate' : 'low' };
}

function runForecast(fd, vertical) {
  const aadt = +fd.aadt || 15000;
  const pop = +fd.pop1mi || +fd.pop3mi/4 || 5000;
  const hh = +fd.hh1mi || +fd.hh3mi/4 || Math.round(pop*0.38);
  const income = +fd.medianIncome || 60000;
  const sqFt = +fd.storeSqft || 3200;
  const dispensers = +fd.fuelPositions || 8;
  const truckPct = (+fd.truckPct||0)/100;
  const speedLimit = 45;
  const hasFoodService = fd.foodservice && fd.foodservice !== 'none';
  const hasDieselIsland = !!fd.hasHighFlowDiesel;
  const truckDieselLanes = +fd.truckDieselLanes || (hasDieselIsland ? 2 : 0);
  const isTravel = vertical === 'travel';

  // Density classification
  const density = classifyDensity(pop, hh, aadt);
  const dc = density.dc;
  const cap = DC_CAPTURE[dc] || DC_CAPTURE[6];

  // Blended capture (60% industry / 40% model)
  const blendedCapture = cap.med * 0.60 + cap.table * 0.40;

  // Competitors
  let compCount = 0;
  if (fd.comp1Brand) compCount++;
  if (fd.comp2Brand) compCount++;
  if (fd.comp3Brand) compCount++;
  if (fd.comp4Brand) compCount++;

  // Adjustment factors
  const compSensitivity = dc <= 3 ? 0.06 : dc <= 5 ? 0.045 : 0.035;
  const compFactor = Math.max(0.65, Math.min(1.30, 1.0 - (compCount * compSensitivity) + (compCount === 0 ? 0.12 : 0)));
  const speedFactor = speedLimit <= 35 ? 1.08 : speedLimit <= 45 ? 1.00 : speedLimit <= 55 ? 0.93 : speedLimit <= 65 ? 0.86 : 0.78;
  const incomeMed = DC_INCOME_MED[dc] || 60000;
  const incomeRatio = income / incomeMed;
  const incomeFactor = Math.max(0.85, Math.min(1.10, 0.85 + (incomeRatio - 0.7) * 0.625));

  const composite = compFactor * speedFactor * incomeFactor;
  const adjustedCapture = Math.max(cap.low, Math.min(blendedCapture * composite, cap.high * 0.6));

  // Daily fuel stops
  const dailyStops = Math.round(aadt * adjustedCapture);
  const baseDieselPct = DC_DIESEL_PCT[dc] || 0.07;
  let dieselShare = baseDieselPct;
  if (hasDieselIsland || truckDieselLanes > 0) {
    const boost = truckDieselLanes >= 4 ? 2.5 : truckDieselLanes >= 2 ? 1.8 : 1.3;
    dieselShare = Math.min(0.85, baseDieselPct * boost + (truckPct > 0 ? truckPct * 0.5 : 0));
  }
  if (isTravel) dieselShare = Math.max(dieselShare, 0.50);

  const gasStops = Math.round(dailyStops * (1 - dieselShare));
  const dieselStops = dailyStops - gasStops;

  // Gallons
  const gasGalPerTxn = isTravel ? 12.5 : 8.4;
  const dieselGalPerTxn = (hasDieselIsland || truckDieselLanes > 0) ? HSD.weighted : 15;
  const dailyGasGal = gasStops * gasGalPerTxn;
  const dailyDieselGal = dieselStops * dieselGalPerTxn;
  const dailyTotalGal = dailyGasGal + dailyDieselGal;
  const monthlyGal = Math.round(dailyTotalGal * 30.4);
  const annualGal = Math.round(dailyTotalGal * 365);
  const galPerDispenser = dispensers > 0 ? Math.round(annualGal / dispensers) : 0;

  // Revenue & margins
  const gasPrice = 3.00;
  const dieselPrice = 3.50;
  const gasMarginCPG = isTravel ? 30 : 22;
  const dieselMarginCPG = isTravel ? 40 : 30;
  const monthlyGasRev = Math.round(dailyGasGal * 30.4 * gasPrice);
  const monthlyDieselRev = Math.round(dailyDieselGal * 30.4 * dieselPrice);
  const monthlyFuelRev = monthlyGasRev + monthlyDieselRev;
  const monthlyFuelGP = Math.round(dailyGasGal * 30.4 * gasMarginCPG/100 + dailyDieselGal * 30.4 * dieselMarginCPG/100);

  // Inside sales
  const conversionRate = hasFoodService ? 0.42 : 0.36;
  const avgTicket = 7.10;
  const dailyInsideTxns = Math.round(dailyStops * conversionRate);
  let monthlyInsideSales = Math.round(dailyInsideTxns * avgTicket * 30.4);
  const insideMargin = hasFoodService ? 0.34 : 0.30;

  // ── SESSION 15: Calibration clamping ──────────────────────
  // Map foodserviceType to Session 15 kitchen type
  const FOOD_MAP = {
    branded_concept: "branded", deli_kitchen: "kitchen", proprietary_kitchen: "full_kitchen",
    roller_grill: "roller_grill", grab_and_go: "basic", pizza_program: "pizza",
    none: "none",
  };
  const s15fd = {
    fuelPositions: dispensers,
    gasPositions: dispensers,
    medianIncome: income,
    storeSqft: sqFt,
    foodservice: FOOD_MAP[fd.foodservice] || (hasFoodService ? "kitchen" : "none"),
    operatingHours: fd.operatingHours || fd.hours || "24hr",
    cornerPosition: fd.cornerPosition || "",
    dieselPositions: +fd.dieselPositions || 0,
    hasHighFlowDiesel: hasDieselIsland,
  };

  // Clamp fuel volume
  const fuelRange = s15FuelRange(s15fd);
  let clampedMonthlyGasGal = Math.round(dailyGasGal * 30.4);
  let clampedMonthlyDieselGal = Math.round(dailyDieselGal * 30.4);
  clampedMonthlyGasGal = clampVal(clampedMonthlyGasGal, fuelRange.floor, fuelRange.ceiling);
  // Diesel: 5-12% of gas for standard, wider for hi-flow
  if (!hasDieselIsland && clampedMonthlyDieselGal > 0) {
    const dFloor = Math.round(fuelRange.floor * 0.05);
    const dCeiling = Math.round(fuelRange.ceiling * 0.12);
    clampedMonthlyDieselGal = clampVal(clampedMonthlyDieselGal, dFloor, dCeiling);
  }
  const clampedMonthlyGal = clampedMonthlyGasGal + clampedMonthlyDieselGal;
  const clampedAnnualGal = Math.round(clampedMonthlyGal * 12);
  const clampedGalPerDispenser = dispensers > 0 ? Math.round(clampedAnnualGal / dispensers) : 0;

  // Recalculate fuel revenue with clamped volumes
  const adjMonthlyGasRev = Math.round(clampedMonthlyGasGal * gasPrice);
  const adjMonthlyDieselRev = Math.round(clampedMonthlyDieselGal * dieselPrice);
  const adjMonthlyFuelRev = adjMonthlyGasRev + adjMonthlyDieselRev;
  const adjMonthlyFuelGP = Math.round(clampedMonthlyGasGal * gasMarginCPG/100 + clampedMonthlyDieselGal * dieselMarginCPG/100);

  // Split inside sales into merch + foodservice, clamp each
  const merchRange = s15MerchRange(s15fd);
  const foodRange = s15FoodRange(s15fd);

  let monthlyMerch, monthlyFood;
  if (hasFoodService && foodRange) {
    // Split: use NACS proportions as starting point, then clamp
    const rawMerchShare = s15fd.foodservice === 'roller_grill' ? 0.92 : 0.75;
    monthlyMerch = clampVal(Math.round(monthlyInsideSales * rawMerchShare), merchRange.floor, merchRange.ceiling);
    monthlyFood = clampVal(Math.round(monthlyInsideSales * (1 - rawMerchShare)), foodRange.floor, foodRange.ceiling);
  } else {
    monthlyMerch = clampVal(monthlyInsideSales, merchRange.floor, merchRange.ceiling);
    monthlyFood = 0;
  }
  // Recalculate total inside sales from clamped components
  monthlyInsideSales = monthlyMerch + monthlyFood;
  const monthlyInsideGP = Math.round(monthlyMerch * 0.30 + monthlyFood * (hasFoodService ? 0.42 : 0));
  const monthlyMerchGP = Math.round(monthlyMerch * 0.30);
  const monthlyFoodGP = Math.round(monthlyFood * 0.42);

  // P&L (NACS ratios) — using clamped values
  const totalGP = adjMonthlyFuelGP + monthlyInsideGP;
  const wages = Math.round(monthlyInsideSales * 0.398);
  const cardFees = Math.round(totalGP * 0.131);
  const utilities = Math.round(monthlyInsideSales * 0.024);
  const repairs = Math.round(monthlyInsideSales * 0.020);
  const propTax = Math.round(monthlyInsideSales * 0.013);
  const insurance = Math.round(monthlyInsideSales * 0.004);
  const supplies = Math.round(monthlyInsideSales * 0.010);
  const other = Math.round(monthlyInsideSales * 0.040);
  const totalOpex = wages + cardFees + utilities + repairs + propTax + insurance + supplies + other;
  const storeEBITDA = totalGP - totalOpex;

  // Year 1 ramp — using clamped values
  const yr1Ramp = 0.70;
  const yr1Gal = Math.round(clampedAnnualGal * yr1Ramp);
  const yr1FuelRev = Math.round(adjMonthlyFuelRev * 12 * yr1Ramp);
  const yr1FuelGP = Math.round(adjMonthlyFuelGP * 12 * yr1Ramp);
  const yr1InsideSales = Math.round(monthlyInsideSales * 12 * yr1Ramp);
  const yr1InsideGP = Math.round(monthlyInsideGP * 12 * yr1Ramp);
  const yr1TotalGP = yr1FuelGP + yr1InsideGP;
  const yr1Opex = Math.round(totalOpex * 12 * 0.85);
  const yr1EBITDA = yr1TotalGP - yr1Opex;

  // Steady state annual — using clamped values
  const ssGal = clampedAnnualGal;
  const ssFuelRev = adjMonthlyFuelRev * 12;
  const ssFuelGP = adjMonthlyFuelGP * 12;
  const ssInsideSales = monthlyInsideSales * 12;
  const ssInsideGP = monthlyInsideGP * 12;
  const ssTotalGP = ssFuelGP + ssInsideGP;
  const ssOpex = totalOpex * 12;
  const ssEBITDA = storeEBITDA * 12;

  // NACS quartile comparison — using clamped values
  const insidePerSqFt = sqFt > 0 ? (monthlyInsideSales * 12) / sqFt : 0;
  const quartile = insidePerSqFt >= 70 ? 'Q1' : insidePerSqFt >= 51 ? 'Q2' : insidePerSqFt >= 39 ? 'Q3' : 'Q4';

  // 5-year projection — using clamped values
  const growthRate = 0.025;
  const fiveYear = [1,2,3,4,5].map(yr => {
    const ramp = yr === 1 ? yr1Ramp : Math.min(1.0, 0.85 + (yr-1)*0.05);
    const growth = Math.pow(1 + growthRate, yr - 1);
    const g = Math.round(clampedAnnualGal * ramp * growth);
    const fRev = Math.round(ssFuelRev * ramp * growth);
    const fGP = Math.round(ssFuelGP * ramp * growth);
    const iSales = Math.round(ssInsideSales * ramp * growth);
    const iGP = Math.round(ssInsideGP * ramp * growth);
    const tGP = fGP + iGP;
    const op = Math.round(ssOpex * Math.min(1.0, 0.85 + (yr-1)*0.05) * growth);
    return { yr, gallons: g, fuelRev: fRev, fuelGP: fGP, insideSales: iSales, insideGP: iGP, totalGP: tGP, opex: op, ebitda: tGP - op };
  });

  return {
    density, dc, aadt, pop, hh, income, sqFt, dispensers, compCount, isTravel,
    hasFoodService, hasDieselIsland, truckDieselLanes,
    blendedCapture, adjustedCapture, composite, compFactor, speedFactor, incomeFactor,
    dailyStops, gasStops, dieselStops, dieselShare,
    dailyGasGal, dailyDieselGal, dailyTotalGal,
    monthlyGal: clampedMonthlyGal, annualGal: clampedAnnualGal, galPerDispenser: clampedGalPerDispenser,
    gasGalPerTxn, dieselGalPerTxn,
    monthlyFuelRev: adjMonthlyFuelRev, monthlyFuelGP: adjMonthlyFuelGP,
    monthlyInsideSales, monthlyInsideGP,
    monthlyMerch, monthlyFood, monthlyMerchGP, monthlyFoodGP,
    totalGP, totalOpex, storeEBITDA,
    wages, cardFees, utilities, repairs, propTax, insurance, supplies, other,
    yr1: { gallons: yr1Gal, fuelRev: yr1FuelRev, fuelGP: yr1FuelGP, insideSales: yr1InsideSales, insideGP: yr1InsideGP, totalGP: yr1TotalGP, opex: yr1Opex, ebitda: yr1EBITDA },
    ss: { gallons: ssGal, fuelRev: ssFuelRev, fuelGP: ssFuelGP, insideSales: ssInsideSales, insideGP: ssInsideGP, totalGP: ssTotalGP, opex: ssOpex, ebitda: ssEBITDA },
    fiveYear,
    insidePerSqFt, quartile,
    gasMarginCPG, dieselMarginCPG,
    // Session 15 calibration metadata
    s15: { fuelRange, merchRange, foodRange, mhi: income },
  };
}

// ─── TIERS / VERTICALS / FORM DEFINITIONS ────────────────────

const TIERS = [
  { id: "quick", label: "Quick Scan", time: "~3 min", price: "$35–50", desc: "Minimum viable inputs for a rough baseline. Best for initial screening of many sites." },
  { id: "standard", label: "Standard", time: "~8 min", price: "$50–75", desc: "Balanced detail for a credible forecast. Best for site selection shortlists and lender presentations." },
  { id: "pro", label: "Pro Detail", time: "~15 min", price: "$75–125", desc: "Maximum precision with full competitive & demographic inputs. Best for final investment decisions." },
  { id: "decision", label: "Decision Package", time: "~20 min", price: "$149–199", desc: "Three full scenarios with side-by-side comparison and analyst recommendation. Best for final go/no-go decisions and investor presentations.", badge: "MOST COMPREHENSIVE" },
];

const VERTICALS = [
  { id: "cstore", label: "C-Store & Fuel", sub: "Convenience stores with fuel dispensers", price: "from $50" },
  { id: "travel", label: "Travel Centers", sub: "Highway facilities with truck services", price: "from $75" },
  { id: "qsr", label: "QSR / Fast Food", sub: "Quick service restaurants", price: "from $60" },
  { id: "hybrid", label: "Grocery Market / Carnicer\u00eda", sub: "Small-format grocery, ethnic market & carnicer\u00eda concepts", price: "from $65" },
  { id: "liquor", label: "Liquor Stores", sub: "Standalone wine, beer & spirits retail", price: "from $55" },
  { id: "carwash", label: "Express Car Wash", sub: "Automated conveyor wash systems", price: "from $60" },
  { id: "laundromat", label: "Laundromats", sub: "Self-service and drop-off facilities", price: "from $50" },
];

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

const SHARED_SITE = [
  { name: "projectName", label: "Project / Site Name", type: "text", placeholder: "e.g. Main St Travel Center", tier: "quick", required: true },
  { name: "siteType", label: "Site Type", type: "radio", tier: "quick", required: true, options: [
    { value: "new", label: "New Construction" }, { value: "raze_rebuild", label: "Raze & Rebuild" },
    { value: "conversion", label: "Conversion / Rebrand" }, { value: "existing", label: "Existing (As-Is)" },
  ]},
  { name: "address", label: "Street Address", type: "text", placeholder: "123 Main Street", tier: "quick", required: false, hint: "Provide address OR coordinates below — one or the other is required" },
  { name: "crossStreets", label: "Cross Streets / Intersection", type: "text", placeholder: "e.g. FM 1488 & Magnolia Ridge Blvd", tier: "quick", required: true, hint: "Primary intersection serving the site — always required" },
  { name: "cornerPosition", label: "Corner / Pad Position", type: "select", tier: "quick", required: true, options: [
    { value: "NE", label: "Northeast corner" }, { value: "NW", label: "Northwest corner" },
    { value: "SE", label: "Southeast corner" }, { value: "SW", label: "Southwest corner" },
    { value: "N", label: "North side of road" }, { value: "S", label: "South side of road" },
    { value: "E", label: "East side of road" }, { value: "W", label: "West side of road" },
    { value: "outparcel", label: "Outparcel / Pad site" }, { value: "unknown", label: "Unknown / TBD" },
  ]},
  { name: "latitude", label: "Latitude", type: "text", placeholder: "30.2125", tier: "quick", required: false, requiredUnless: "address", half: true, hint: "Decimal degrees (e.g. 30.2125)" },
  { name: "longitude", label: "Longitude", type: "text", placeholder: "-95.7365", tier: "quick", required: false, requiredUnless: "address", half: true, hint: "U.S. longitudes are negative (e.g. -95.7365)" },
  { name: "_coordHelper", label: "", type: "helper", tier: "quick", hideIf: "address", helperText: "Don't know coordinates?", helperLinkText: "Find on Google Maps →", helperUrl: "https://www.google.com/maps", helperInstructions: "Right-click your site → select 'What's here?' → copy the decimal coordinates" },
  { name: "city", label: "City", type: "text", placeholder: "Nashville", tier: "quick", required: true, half: true },
  { name: "state", label: "State", type: "select", options: US_STATES, tier: "quick", required: true, half: true },
  { name: "zip", label: "ZIP Code", type: "text", placeholder: "37201", tier: "quick", half: true },
  { name: "county", label: "County", type: "text", placeholder: "Montgomery County", tier: "quick", half: true },
  { name: "padSite", label: "Pad Site / Outparcel?", type: "text", placeholder: "e.g. Walmart outparcel, standalone", tier: "standard", half: true },
  { name: "nearestInterstate", label: "Nearest Interstate", type: "text", placeholder: "e.g. I-40", tier: "standard", half: true },
  { name: "interchangeDistance", label: "Distance to Interchange", type: "text", placeholder: "0.3", suffix: "mi", tier: "standard", half: true },
  { name: "accessType", label: "Site Access", type: "select", tier: "pro", half: true, options: [
    { value: "signalized", label: "Signalized intersection" }, { value: "right_in_out", label: "Right-in / Right-out only" },
    { value: "full_access", label: "Full access (no median)" }, { value: "divided_hwy", label: "Divided highway with turn lane" },
  ]},
  { name: "visibility", label: "Visibility Rating", type: "select", tier: "pro", half: true, options: [
    { value: "excellent", label: "Excellent — visible 1/4+ mile" }, { value: "good", label: "Good — visible from road" },
    { value: "moderate", label: "Moderate — setback/obstructed" }, { value: "poor", label: "Poor — limited visibility" },
  ]},
];

const SHARED_TRAFFIC = [
  { name: "aadt", label: "AADT (Annual Avg Daily Traffic)", type: "number", placeholder: "12500", tier: "quick", hint: "Primary road — leave blank if unknown, we'll pull it" },
  { name: "aadtSource", label: "AADT Source", type: "text", placeholder: "e.g. State DOT 2024", tier: "standard", half: true },
  { name: "aadtSecondary", label: "Secondary Road AADT", type: "number", placeholder: "4500", tier: "pro", half: true },
  { name: "truckPct", label: "Truck % of Traffic", type: "number", placeholder: "8", suffix: "%", tier: "standard", half: true },
  { name: "medianIncome", label: "Median Household Income", type: "number", placeholder: "52000", prefix: "$", tier: "standard", half: true, hint: "3-mi trade area" },
  { name: "pop1mi", label: "Population (1-mile)", type: "number", placeholder: "1800", tier: "standard", half: true },
  { name: "pop3mi", label: "Population (3-mile)", type: "number", placeholder: "8500", tier: "standard", half: true },
  { name: "pop5mi", label: "Population (5-mile)", type: "number", placeholder: "22000", tier: "pro", half: true },
  { name: "hh1mi", label: "Households (1-mile)", type: "number", placeholder: "720", tier: "pro", half: true },
  { name: "hh3mi", label: "Households (3-mile)", type: "number", placeholder: "3400", tier: "pro", half: true },
  { name: "daytimePop", label: "Daytime Population (3-mi)", type: "number", placeholder: "6200", tier: "pro", half: true },
  { name: "popGrowth", label: "Population Growth Trend", type: "select", tier: "pro", half: true, options: [
    { value: "declining", label: "Declining (−2%+)" }, { value: "flat", label: "Flat / Stable" },
    { value: "moderate", label: "Moderate (1–3%)" }, { value: "high", label: "High growth (3%+)" },
  ]},
  { name: "nearestEmployer", label: "Major Employer Nearby", type: "text", placeholder: "e.g. Eastman Chemical — 5 mi, 14K employees", tier: "pro" },
];

const SCENARIO_FIELDS = [
  { name: "scenarioALabel", label: "Scenario A — Label", type: "text", placeholder: "Base Case (as specified above)", tier: "decision", required: true, hint: "This is your primary projection — the facility as you've described it" },
  { name: "scenarioBLabel", label: "Scenario B — Label", type: "text", placeholder: "e.g. Enhanced Foodservice / Larger Format / Add Diesel", tier: "decision", required: true },
  { name: "scenarioBDesc", label: "Scenario B — Description", type: "textarea", placeholder: "Describe the key changes from the base case. Examples:\n• What if we add Krispy Krunchy Chicken instead of grab-and-go?\n• What if we build 8 dispensers instead of 6?\n• What if we add hi-flow diesel truck lanes?\n• What if we increase store size to 6,000 SF?", tier: "decision", required: true },
  { name: "scenarioCLabel", label: "Scenario C — Label", type: "text", placeholder: "e.g. Competitive Response / Downside / Alternative Concept", tier: "decision", required: true },
  { name: "scenarioCDesc", label: "Scenario C — Description", type: "textarea", placeholder: "Describe the key changes from the base case. Examples:\n• What if a QuikTrip opens within 1 mile during Year 2?\n• What if AADT growth doesn't materialize as projected?\n• What if we go with a smash burger program instead of fried chicken?\n• What if the highway widening is delayed 2 years?", tier: "decision", required: true },
  { name: "scenarioFocus", label: "Decision Variables", type: "select", tier: "decision", multiple: true, hint: "What are you trying to decide? (select all that apply)", options: [
    { value: "foodservice_concept", label: "Foodservice concept / menu strategy" },
    { value: "store_size", label: "Store size / format" },
    { value: "fuel_infrastructure", label: "Fuel infrastructure (dispensers, diesel, truck lanes)" },
    { value: "brand_affiliation", label: "Fuel or store brand affiliation" },
    { value: "competitive_response", label: "Competitive entry / response" },
    { value: "market_timing", label: "Market timing / growth assumptions" },
    { value: "attached_retail", label: "Attached retail (car wash, liquor, QSR)" },
    { value: "operating_model", label: "Operating model (hours, staffing, services)" },
    { value: "other", label: "Other (describe in notes)" },
  ]},
  { name: "scenarioNotes", label: "Additional Scenario Context", type: "textarea", placeholder: "Any additional context for the scenario analysis — decision timeline, investor concerns, lender requirements, specific questions you want addressed...", tier: "decision" },
];

const VF = {
  cstore: { sections: [
    { id: "format", title: "Store Format & Facility", n: "01", fields: [
      { name: "storeFormat", label: "Store Format", type: "radio", tier: "quick", required: true, options: [
        { value: "small", label: "Small C-Store (< 2,500 SF)" }, { value: "mid", label: "Standard (2,500–4,000 SF)" },
        { value: "large", label: "Large C-Store (4,000+ SF)" }, { value: "kiosk", label: "Fuel Kiosk / Minimal" },
      ]},
      { name: "storeSqft", label: "Store Square Footage", type: "number", placeholder: "3200", suffix: "SF", tier: "quick", required: true, half: true },
      { name: "lotSize", label: "Total Lot Size", type: "number", placeholder: "1.5", suffix: "acres", tier: "standard", half: true },
      { name: "yearBuilt", label: "Year Built", type: "number", placeholder: "2026", tier: "standard", half: true },
      { name: "brandAffiliation", label: "Store Brand / Banner", type: "text", placeholder: "e.g. Circle K, Independent", tier: "standard", half: true },
    ]},
    { id: "fuel", title: "Fuel & Forecourt", n: "02", fields: [
      { name: "fuelBrand", label: "Fuel Brand", type: "select", tier: "quick", required: true, half: true, options: ["Unbranded","Shell","BP","ExxonMobil","Chevron","Marathon","Citgo","Valero","Sunoco","Phillips 66","Murphy USA","RaceTrac","Sheetz","QuikTrip","Casey's","Other"] },
      { name: "fuelPositions", label: "Fuel Positions (MPDs)", type: "number", placeholder: "8", tier: "quick", required: true, half: true },
      { name: "hasDiesel", label: "Diesel Available", type: "toggle", tier: "quick" },
      { name: "dieselPositions", label: "Diesel Positions", type: "number", placeholder: "2", tier: "standard", half: true, showIf: "hasDiesel" },
      { name: "hasHighFlowDiesel", label: "High-Flow Diesel (Truck)", type: "toggle", tier: "standard", showIf: "hasDiesel" },
      { name: "hasDEF", label: "DEF (Diesel Exhaust Fluid)", type: "toggle", tier: "standard" },
      { name: "hasEthanol", label: "E-85 / Flex Fuel", type: "toggle", tier: "pro" },
      { name: "hasEV", label: "EV Charging", type: "toggle", tier: "pro" },
    ]},
    { id: "inside", title: "Inside Sales & Merchandise", n: "03", fields: [
      { name: "foodservice", label: "Foodservice Program", type: "radio", tier: "standard", options: [
        { value: "none", label: "None" }, { value: "roller_grill", label: "Roller Grill / Grab & Go" }, { value: "proprietary", label: "Proprietary Foodservice" },
        { value: "branded_qsr", label: "Branded QSR" }, { value: "full_kitchen", label: "Full Kitchen" }, { value: "pizza", label: "Pizza Program" },
      ]},
      { name: "qsrBrand", label: "QSR Brand Name", type: "text", placeholder: "e.g. Subway", tier: "standard", half: true, showIf: "foodservice=branded_qsr" },
      { name: "hasBeer", label: "Beer & Wine Sales", type: "toggle", tier: "quick" },
      { name: "hasTobacco", label: "Tobacco / Nicotine", type: "toggle", tier: "quick" },
      { name: "hasLottery", label: "Lottery", type: "toggle", tier: "standard" },
      { name: "hasATM", label: "ATM", type: "toggle", tier: "pro" },
    ]},
    { id: "ops", title: "Operations", n: "04", fields: [
      { name: "hours", label: "Operating Hours", type: "radio", tier: "quick", options: [{ value: "24hr", label: "24 Hours" }, { value: "extended", label: "5am–12am" }, { value: "standard", label: "6am–10pm" }] },
      { name: "staffCount", label: "Staff Count", type: "number", placeholder: "8", tier: "standard", half: true },
    ]},
    { id: "comp", title: "Competition", n: "05", fields: [
      { name: "comp1Brand", label: "Competitor #1 — Brand", type: "text", placeholder: "e.g. Shell", tier: "quick", half: true },
      { name: "comp1Distance", label: "Competitor #1 — Distance", type: "text", placeholder: "0.3 mi", tier: "quick", half: true },
      { name: "comp2Brand", label: "Competitor #2 — Brand", type: "text", placeholder: "e.g. BP", tier: "standard", half: true },
      { name: "comp2Distance", label: "Competitor #2 — Distance", type: "text", placeholder: "0.8 mi", tier: "standard", half: true },
      { name: "comp3Brand", label: "Competitor #3", type: "text", tier: "standard", half: true },
      { name: "comp3Distance", label: "Comp #3 Distance", type: "text", tier: "standard", half: true },
      { name: "comp4Brand", label: "Competitor #4", type: "text", tier: "pro", half: true },
      { name: "comp4Distance", label: "Comp #4 Distance", type: "text", tier: "pro", half: true },
      { name: "compNotes", label: "Competition Notes", type: "textarea", placeholder: "Additional context...", tier: "pro" },
    ]},
  ]},
  travel: { sections: [
    { id: "fac", title: "Facility & Format", n: "01", fields: [
      { name: "tcFormat", label: "Travel Center Format", type: "radio", tier: "quick", required: true, options: [{ value: "full_tc", label: "Full Travel Center" }, { value: "truck_stop", label: "Truck Stop (heavy diesel)" }, { value: "hybrid_tc", label: "Hybrid (TC + QSR)" }, { value: "independent", label: "Independent / Small" }] },
      { name: "storeSqft", label: "Retail Square Footage", type: "number", placeholder: "8000", suffix: "SF", tier: "quick", required: true, half: true },
      { name: "lotSize", label: "Total Lot Size", type: "number", placeholder: "12", suffix: "acres", tier: "quick", half: true },
      { name: "tcBrand", label: "Brand Affiliation", type: "select", tier: "standard", options: ["Independent","Pilot/Flying J","Love's","TA/Petro","Ambest","Buc-ee's","Maverik","Other"] },
    ]},
    { id: "fuel", title: "Fuel & Diesel", n: "02", fields: [
      { name: "fuelPositions", label: "Car Fuel Positions", type: "number", placeholder: "12", tier: "quick", required: true, half: true },
      { name: "truckDieselLanes", label: "Truck Diesel Lanes", type: "number", placeholder: "8", tier: "quick", required: true, half: true },
      { name: "fuelBrand", label: "Fuel Brand", type: "select", tier: "standard", half: true, options: ["Unbranded","Shell","BP","ExxonMobil","Chevron","Marathon","Citgo","Valero","Phillips 66","Other"] },
      { name: "hasDEF", label: "DEF at Diesel Lanes", type: "toggle", tier: "standard" },
      { name: "hasScales", label: "CAT Scales", type: "toggle", tier: "standard" },
    ]},
    { id: "truck", title: "Truck Services", n: "03", fields: [
      { name: "truckParking", label: "Truck Parking Spaces", type: "number", placeholder: "120", tier: "quick", required: true, half: true },
      { name: "showerCount", label: "Shower Rooms", type: "number", placeholder: "12", tier: "standard", half: true },
      { name: "hasLaundry", label: "Laundry Facility", type: "toggle", tier: "standard" },
      { name: "hasTruckRepair", label: "Truck Repair", type: "toggle", tier: "standard" },
    ]},
    { id: "rest", title: "Restaurant / Foodservice", n: "04", fields: [
      { name: "foodservice", label: "Restaurant Format", type: "radio", tier: "quick", options: [{ value: "none", label: "No restaurant" }, { value: "branded_qsr", label: "Branded QSR" }, { value: "food_court", label: "Food Court" }, { value: "full_service", label: "Full-Service" }, { value: "proprietary", label: "Proprietary" }] },
      { name: "qsrBrands", label: "QSR Brand(s)", type: "text", placeholder: "e.g. Wendy's, Cinnabon", tier: "standard", showIf: "foodservice=branded_qsr||foodservice=food_court" },
    ]},
    { id: "comp", title: "Competition", n: "05", fields: [
      { name: "comp1Brand", label: "Competitor #1", type: "text", placeholder: "e.g. Pilot — 12 mi", tier: "quick", half: true },
      { name: "comp1Distance", label: "Distance", type: "text", placeholder: "12 mi", tier: "quick", half: true },
      { name: "comp2Brand", label: "Competitor #2", type: "text", tier: "standard", half: true },
      { name: "comp2Distance", label: "Distance", type: "text", tier: "standard", half: true },
      { name: "compNotes", label: "Notes", type: "textarea", tier: "pro" },
    ]},
  ]},
  qsr: { sections: [{ id: "f", title: "Format", n: "01", fields: [{ name: "storeSqft", label: "SF", type: "number", placeholder: "2800", tier: "quick", half: true }]}] },
  hybrid: { sections: [{ id: "f", title: "Format", n: "01", fields: [{ name: "storeSqft", label: "SF", type: "number", placeholder: "6000", tier: "quick", half: true }]}] },
  liquor: { sections: [{ id: "f", title: "Format", n: "01", fields: [{ name: "storeSqft", label: "SF", type: "number", placeholder: "3500", tier: "quick", half: true }]}] },
  carwash: { sections: [{ id: "f", title: "Format", n: "01", fields: [{ name: "storeSqft", label: "SF", type: "number", placeholder: "0", tier: "quick", half: true }]}] },
  laundromat: { sections: [{ id: "f", title: "Format", n: "01", fields: [{ name: "storeSqft", label: "SF", type: "number", placeholder: "2500", tier: "quick", half: true }]}] },
};

// ─── FIELD COMPONENT ─────────────────────────────────────────

const tierOrder = { quick: 0, standard: 1, pro: 2, decision: 3 };
const lbl = { fontSize: 12, fontWeight: 600, color: "#999", marginBottom: 5, display: "block", letterSpacing: "0.02em" };
const inp = { width: "100%", padding: "10px 12px", background: "#111", border: "1px solid #222", color: "#fff", fontSize: 14, fontFamily: "'Inter', sans-serif", outline: "none", transition: "border-color 0.3s" };

function Field({ field, value, onChange, allValues }) {
  const w = { flex: field.half ? "1 1 calc(50% - 8px)" : "1 1 100%", minWidth: field.half ? 200 : 0, marginBottom: 4 };
  // Dynamic required: field is required if requiredUnless field is empty
  const isRequired = field.required || (field.requiredUnless && !allValues[field.requiredUnless]);
  if (field.showIf) {
    const parts = field.showIf.split("||").map(s => s.trim());
    const vis = parts.some(p => { if (p.includes("=")) { const [k,v] = p.split("="); return allValues[k] === v; } return !!allValues[p]; });
    if (!vis) return null;
  }
  if (field.hideIf && allValues[field.hideIf]) return null;
  if (field.type === "toggle") {
    const c = !!value;
    return (<div style={w}><label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none", padding: "5px 0" }} onClick={() => onChange(field.name, !c)}>
      <div style={{ width: 36, height: 20, borderRadius: 10, background: c ? "#fff" : "#222", transition: "0.3s", position: "relative" }}><div style={{ width: 16, height: 16, borderRadius: 8, background: c ? "#000" : "#444", position: "absolute", top: 2, left: c ? 18 : 2, transition: "0.3s" }} /></div>
      <span style={{ fontSize: 13, color: c ? "#fff" : "#666" }}>{field.label}</span></label></div>);
  }
  if (field.type === "radio") {
    return (<div style={{ ...w, flex: "1 1 100%" }}><label style={lbl}>{field.label} {isRequired && <span style={{ color: "#fff" }}>*</span>}</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{field.options.map(o => (
        <div key={o.value} onClick={() => onChange(field.name, o.value)} style={{ padding: "8px 16px", border: value === o.value ? "1px solid #fff" : "1px solid #222", background: value === o.value ? "#fff" : "transparent", color: value === o.value ? "#000" : "#666", fontSize: 13, cursor: "pointer", fontWeight: value === o.value ? 700 : 400, transition: "all 0.3s" }}>{o.label}</div>
      ))}</div></div>);
  }
  if (field.type === "textarea") {
    return (<div style={w}><label style={lbl}>{field.label}</label><textarea value={value || ""} onChange={e => onChange(field.name, e.target.value)} placeholder={field.placeholder} style={{ ...inp, minHeight: 70, resize: "vertical" }} /></div>);
  }
  if (field.type === "helper") {
    return (<div style={{ flex: "1 1 100%", marginBottom: 4, padding: "10px 14px", background: "#0a1628", border: "1px solid #1a3050", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: "#6688aa" }}>{field.helperText}</span>
      <a href={field.helperUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: "#4a9eff", textDecoration: "none" }}
        onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"} onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}>{field.helperLinkText}</a>
      {field.helperInstructions && <span style={{ fontSize: 11, color: "#445566", flex: "1 1 100%" }}>{field.helperInstructions}</span>}
    </div>);
  }
  if (field.type === "select") {
    return (<div style={w}><label style={lbl}>{field.label} {isRequired && <span style={{ color: "#fff" }}>*</span>}</label>
      <select value={value || ""} onChange={e => onChange(field.name, e.target.value)} style={{ ...inp, appearance: "none" }}>
        <option value="">Select...</option>{(field.options || []).map(o => typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select></div>);
  }
  return (<div style={w}><label style={lbl}>{field.label} {isRequired && <span style={{ color: "#fff" }}>*</span>}</label>
    <div style={{ position: "relative" }}>
      {field.prefix && <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#444", fontSize: 14 }}>{field.prefix}</span>}
      <input type={field.type} value={value || ""} onChange={e => onChange(field.name, e.target.value)} placeholder={field.placeholder} style={{ ...inp, paddingLeft: field.prefix ? 28 : 12, paddingRight: field.suffix ? 40 : 12 }} onFocus={e => e.target.style.borderColor = "#444"} onBlur={e => e.target.style.borderColor = "#222"} />
      {field.suffix && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#444", fontSize: 13 }}>{field.suffix}</span>}
    </div>
    {field.hint && <span style={{ fontSize: 11, color: "#444", marginTop: 2, display: "block" }}>{field.hint}</span>}</div>);
}

// ─── RESULTS DASHBOARD ───────────────────────────────────────

const $ = n => '$' + Math.round(n).toLocaleString();
const K = n => n >= 1000000 ? '$' + (n/1000000).toFixed(2) + 'M' : n >= 1000 ? '$' + Math.round(n/1000).toLocaleString() + 'K' : '$' + Math.round(n).toLocaleString();
const G = n => n >= 1000000 ? (n/1000000).toFixed(2) + 'M' : Math.round(n).toLocaleString();
const P = n => (n * 100).toFixed(2) + '%';

function StatCard({ label, value, sub, accent }) {
  return (<div style={{ padding: "24px 20px", border: accent ? "1px solid #fff" : "1px solid #222", background: accent ? "#fff" : "transparent", flex: "1 1 200px", minWidth: 180 }}>
    <div style={{ fontSize: 11, fontWeight: 700, color: accent ? "#666" : "#555", letterSpacing: "0.08em", marginBottom: 8, textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: "1.75rem", fontWeight: 900, color: accent ? "#000" : "#fff", letterSpacing: "-0.02em", lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: accent ? "#888" : "#444", marginTop: 4 }}>{sub}</div>}
  </div>);
}

function ResultsDashboard({ forecast: f, formData: fd, vertical, tier, goLanding }) {
  const vMeta = VERTICALS.find(v => v.id === vertical);
  const siteName = fd.projectName || fd.crossStreets || fd.address || 'Site';
  const [tab, setTab] = useState('summary');

  const tabStyle = (id) => ({
    padding: "8px 20px", fontSize: 13, fontWeight: tab === id ? 700 : 400,
    color: tab === id ? "#000" : "#666", background: tab === id ? "#fff" : "transparent",
    border: "none", cursor: "pointer", fontFamily: "'Inter', sans-serif",
    borderBottom: tab === id ? "none" : "1px solid #222",
    transition: "all 0.2s",
  });

  const row = (label, val, bold) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #111", fontSize: 14 }}>
      <span style={{ color: "#888" }}>{label}</span>
      <span style={{ color: "#fff", fontWeight: bold ? 800 : 500, fontVariantNumeric: "tabular-nums" }}>{val}</span>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#000", color: "#fff", minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <header style={{ padding: "1.25rem 5%", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #222" }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em", cursor: "pointer" }} onClick={goLanding}>RunSiteScratch</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: "#666" }}>{vMeta?.label}</span>
          <span style={{ fontSize: 11, color: "#999", fontWeight: 600, padding: "4px 10px", border: "1px solid #222" }}>{TIERS.find(t=>t.id===tier)?.label}</span>
        </div>
      </header>

      {/* Title */}
      <div style={{ padding: "3rem 5% 1.5rem", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#444", letterSpacing: "0.1em", marginBottom: 8 }}>FORECAST RESULTS</div>
        <h1 style={{ fontSize: "clamp(1.75rem, 4vw, 2.75rem)", fontWeight: 900, letterSpacing: "-0.03em", margin: 0 }}>{siteName}</h1>
        <div style={{ fontSize: 14, color: "#666", marginTop: 6 }}>
          {fd.address && <span>{fd.address}, </span>}
          {fd.crossStreets && !fd.address && <span>{fd.crossStreets}, </span>}
          {fd.city}{fd.state ? `, ${fd.state}` : ''} {fd.zip || ''}
          {fd.latitude && fd.longitude && <span style={{ color: "#444", marginLeft: 8, fontSize: 12 }}>({fd.latitude}, {fd.longitude})</span>}
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, padding: "4px 12px", border: "1px solid #333", color: "#999" }}>DC {f.dc} — {f.density.label}</span>
          <span style={{ fontSize: 12, padding: "4px 12px", border: "1px solid #333", color: "#999" }}>AADT {f.aadt.toLocaleString()}</span>
          <span style={{ fontSize: 12, padding: "4px 12px", border: "1px solid #333", color: "#999" }}>{f.dispensers} dispensers{f.truckDieselLanes > 0 ? ` + ${f.truckDieselLanes} TDL` : ''}</span>
          <span style={{ fontSize: 12, padding: "4px 12px", border: "1px solid #333", color: f.quartile === 'Q1' ? '#fff' : '#999', borderColor: f.quartile === 'Q1' ? '#fff' : '#333' }}>NACS {f.quartile}</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ padding: "1rem 5% 2rem", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <StatCard label="Annual Gallons (SS)" value={G(f.ss.gallons)} sub={`${G(f.monthlyGal)} / month`} accent />
          <StatCard label="Store EBITDA (SS)" value={K(f.ss.ebitda)} sub={`${$(f.storeEBITDA)} / month`} accent />
          <StatCard label="Year 1 Gallons" value={G(f.yr1.gallons)} sub="70% ramp factor" />
          <StatCard label="Year 1 EBITDA" value={K(f.yr1.ebitda)} sub="Ramped volume + opex" />
          <StatCard label="Gal / Dispenser" value={G(f.galPerDispenser)} sub={`${f.dispensers} positions`} />
          <StatCard label="Inside $/SqFt" value={'$' + f.insidePerSqFt.toFixed(2)} sub={`${f.sqFt.toLocaleString()} SF`} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: "1px solid #222", padding: "0 5%", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 0 }}>
          {[['summary','Summary'],['fuel','Fuel Detail'],['pnl','P&L'],['fiveyr','5-Year'],['nacs','NACS Benchmark']].map(([id, label]) =>
            <button key={id} style={tabStyle(id)} onClick={() => setTab(id)}>{label}</button>
          )}
        </div>
      </div>

      {/* Tab Content */}
      <div style={{ padding: "2rem 5% 4rem", maxWidth: 1100, margin: "0 auto" }}>

        {tab === 'summary' && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#555", letterSpacing: "0.08em", marginBottom: 16 }}>SITE CLASSIFICATION</h3>
              {row('Density Class', `DC ${f.dc} — ${f.density.label}`)}
              {row('Trade Radius', `${DENSITY_CLASS_CENTROIDS[f.dc].tradeRadius} mi`)}
              {row('Confidence', f.density.confidence)}
              {row('Alternate', `DC ${f.density.alt} — ${f.density.altLabel}`)}
              {row('Population (input)', f.pop.toLocaleString())}
              {row('Households (est)', f.hh.toLocaleString())}
              {row('Median Income', $(f.income))}
              {row('AADT', f.aadt.toLocaleString())}
              {row('Competitors', f.compCount.toString())}
            </div>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#555", letterSpacing: "0.08em", marginBottom: 16 }}>CAPTURE RATE</h3>
              {row('Blended Capture', P(f.blendedCapture))}
              {row('Competitive Factor', f.compFactor.toFixed(3) + '×')}
              {row('Speed Factor', f.speedFactor.toFixed(3) + '×')}
              {row('Income Factor', f.incomeFactor.toFixed(3) + '×')}
              {row('Composite', f.composite.toFixed(3) + '×')}
              {row('Adjusted Capture', P(f.adjustedCapture), true)}
              {row('Daily Fuel Stops', f.dailyStops.toLocaleString(), true)}
            </div>
            {f.s15 && (
              <div style={{ gridColumn: "1 / -1", marginTop: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#555", letterSpacing: "0.08em", marginBottom: 16 }}>SESSION 15 CALIBRATION RANGES</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#444", fontWeight: 600, marginBottom: 6 }}>FUEL (gal/mo)</div>
                    {row('Floor', f.s15.fuelRange.floor.toLocaleString())}
                    {row('Midpoint', f.s15.fuelRange.mid.toLocaleString())}
                    {row('Ceiling', f.s15.fuelRange.ceiling.toLocaleString())}
                    {row('Projected', f.monthlyGal.toLocaleString(), true)}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "#444", fontWeight: 600, marginBottom: 6 }}>MERCHANDISE ($/mo)</div>
                    {row('Floor', $(f.s15.merchRange.floor))}
                    {row('Midpoint', $(f.s15.merchRange.mid))}
                    {row('Ceiling', $(f.s15.merchRange.ceiling))}
                    {row('Projected', $(f.monthlyMerch), true)}
                  </div>
                  {f.s15.foodRange && (
                    <div>
                      <div style={{ fontSize: 11, color: "#444", fontWeight: 600, marginBottom: 6 }}>FOODSERVICE ($/mo)</div>
                      {row('Floor', $(f.s15.foodRange.floor))}
                      {row('Ceiling', $(f.s15.foodRange.ceiling))}
                      {row('Projected', $(f.monthlyFood), true)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'fuel' && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#555", letterSpacing: "0.08em", marginBottom: 16 }}>DAILY VOLUME</h3>
              {row('Gas Stops / Day', f.gasStops.toLocaleString())}
              {row('Diesel Stops / Day', f.dieselStops.toLocaleString())}
              {row('Gas Gal / Transaction', f.gasGalPerTxn.toFixed(1))}
              {row('Diesel Gal / Transaction', f.dieselGalPerTxn.toFixed(1))}
              {row('Daily Gas Gallons', Math.round(f.dailyGasGal).toLocaleString())}
              {row('Daily Diesel Gallons', Math.round(f.dailyDieselGal).toLocaleString())}
              {row('Daily Total Gallons', Math.round(f.dailyTotalGal).toLocaleString(), true)}
              {row('Diesel Share', (f.dieselShare * 100).toFixed(1) + '%')}
            </div>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#555", letterSpacing: "0.08em", marginBottom: 16 }}>MONTHLY & ANNUAL</h3>
              {row('Monthly Gallons', f.monthlyGal.toLocaleString(), true)}
              {row('Annual Gallons (SS)', f.annualGal.toLocaleString(), true)}
              {row('Year 1 Gallons (70%)', f.yr1.gallons.toLocaleString())}
              {row('Gal / Dispenser', f.galPerDispenser.toLocaleString())}
              {row('Gas Margin', f.gasMarginCPG + '¢ / gal')}
              {row('Diesel Margin', f.dieselMarginCPG + '¢ / gal')}
              {row('Monthly Fuel Revenue', $(f.monthlyFuelRev))}
              {row('Monthly Fuel GP', $(f.monthlyFuelGP), true)}
              {f.hasDieselIsland && row('Diesel Island', 'Yes — ' + f.truckDieselLanes + ' truck lanes')}
            </div>
          </div>
        )}

        {tab === 'pnl' && (
          <div style={{ maxWidth: 550 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#555", letterSpacing: "0.08em", marginBottom: 16 }}>MONTHLY STORE P&L</h3>
            <div style={{ borderTop: "1px solid #333", paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#555", letterSpacing: "0.06em", marginBottom: 4 }}>REVENUE</div>
              {row('Fuel Sales', $(f.monthlyFuelRev))}
              {row('Merchandise', $(f.monthlyMerch))}
              {f.monthlyFood > 0 && row('Foodservice', $(f.monthlyFood))}
              {row('TOTAL REVENUE', $(f.monthlyFuelRev + f.monthlyInsideSales), true)}
            </div>
            <div style={{ borderTop: "1px solid #333", paddingTop: 12, marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#555", letterSpacing: "0.06em", marginBottom: 4 }}>GROSS PROFIT</div>
              {row('Fuel GP', $(f.monthlyFuelGP))}
              {row('Merchandise GP', $(f.monthlyMerchGP))}
              {f.monthlyFoodGP > 0 && row('Foodservice GP', $(f.monthlyFoodGP))}
              {row('TOTAL GP', $(f.totalGP), true)}
            </div>
            <div style={{ borderTop: "1px solid #333", paddingTop: 12, marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#555", letterSpacing: "0.06em", marginBottom: 4 }}>OPERATING EXPENSES</div>
              {row('Wages & Benefits', $(f.wages))}
              {row('Card Fees', $(f.cardFees))}
              {row('Utilities', $(f.utilities))}
              {row('Repairs & Maint', $(f.repairs))}
              {row('Taxes & Insurance', $(f.propTax + f.insurance))}
              {row('Supplies & Other', $(f.supplies + f.other))}
              {row('TOTAL OPEX', $(f.totalOpex), true)}
            </div>
            <div style={{ borderTop: "2px solid #fff", paddingTop: 12, marginTop: 12 }}>
              {row('STORE EBITDA', $(f.storeEBITDA), true)}
              {row('ANNUAL EBITDA', $(f.ss.ebitda), true)}
              {row('Store Margin', ((f.storeEBITDA / (f.monthlyFuelRev + f.monthlyInsideSales)) * 100).toFixed(1) + '%')}
            </div>
          </div>
        )}

        {tab === 'fiveyr' && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#555", letterSpacing: "0.08em", marginBottom: 16 }}>5-YEAR PROJECTION</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #333" }}>
                    {['Year','Gallons','Fuel Rev','Fuel GP','Inside Sales','Inside GP','Total GP','Opex','EBITDA'].map(h =>
                      <th key={h} style={{ padding: "10px 12px", textAlign: "right", color: "#555", fontWeight: 700, fontSize: 12, letterSpacing: "0.05em" }}>{h}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {f.fiveYear.map(yr => (
                    <tr key={yr.yr} style={{ borderBottom: "1px solid #111" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 800, color: "#fff" }}>Yr {yr.yr}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#ccc" }}>{G(yr.gallons)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#ccc" }}>{K(yr.fuelRev)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#ccc" }}>{K(yr.fuelGP)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#ccc" }}>{K(yr.insideSales)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#ccc" }}>{K(yr.insideGP)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#fff", fontWeight: 700 }}>{K(yr.totalGP)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#888" }}>{K(yr.opex)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: yr.ebitda > 0 ? "#fff" : "#f66", fontWeight: 800 }}>{K(yr.ebitda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, fontSize: 12, color: "#444" }}>Year 1 at 70% ramp. Years 2–5 ramp to 100% with 2.5% annual growth.</div>
          </div>
        )}

        {tab === 'nacs' && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#555", letterSpacing: "0.08em", marginBottom: 16 }}>NACS QUARTILE BENCHMARK (MONTHLY)</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #333" }}>
                    {['','Q4 (Bottom)','Q3','Q2','Q1 (Top)','THIS SITE'].map(h =>
                      <th key={h} style={{ padding: "10px 12px", textAlign: "right", color: h === 'THIS SITE' ? '#fff' : "#555", fontWeight: 700, fontSize: 12 }}>{h}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Fuel Gal/Mo', [NACS.Q4.gal, NACS.Q3.gal, NACS.Q2.gal, NACS.Q1.gal, f.monthlyGal]],
                    ['Inside Sales', [NACS.Q4.inside, NACS.Q3.inside, NACS.Q2.inside, NACS.Q1.inside, f.monthlyInsideSales]],
                    ['Inside GP', [NACS.Q4.insideGP, NACS.Q3.insideGP, NACS.Q2.insideGP, NACS.Q1.insideGP, f.monthlyInsideGP]],
                    ['$/SqFt', [NACS.Q4.perSqFt, NACS.Q3.perSqFt, NACS.Q2.perSqFt, NACS.Q1.perSqFt, f.insidePerSqFt]],
                    ['Pool ¢/gal', [NACS.Q4.poolCPG, NACS.Q3.poolCPG, NACS.Q2.poolCPG, NACS.Q1.poolCPG, (f.gasMarginCPG + f.dieselMarginCPG)/2]],
                    ['Total Opex', [NACS.Q4.opex, NACS.Q3.opex, NACS.Q2.opex, NACS.Q1.opex, f.totalOpex]],
                  ].map(([label, vals]) => (
                    <tr key={label} style={{ borderBottom: "1px solid #111" }}>
                      <td style={{ padding: "10px 12px", color: "#888", fontWeight: 600 }}>{label}</td>
                      {vals.map((v, i) => (
                        <td key={i} style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: i === 4 ? "#fff" : "#666", fontWeight: i === 4 ? 800 : 400 }}>
                          {typeof v === 'number' ? (v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2)) : v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #222", padding: "2rem 5%", maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <p style={{ fontSize: 11, color: "#333", maxWidth: 650, lineHeight: 1.5, fontStyle: "italic", margin: 0 }}>
          These projections are estimates based on industry benchmarks blended with NACS 2024 data. Not guaranteed outcomes. Actual results depend on execution, local demographics, and market conditions.
        </p>
        <button onClick={goLanding} style={{ padding: "10px 24px", background: "#fff", color: "#000", border: "none", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>New Forecast</button>
      </div>
    </div>
  );
}

// ─── PROCESSING ANIMATION ────────────────────────────────────

function ProcessingScreen({ siteName, onComplete }) {
  const [step, setStep] = useState(0);
  const steps = ['Classifying density class...', 'Calculating capture rates...', 'Running fuel volume model...', 'Projecting inside sales...', 'Building P&L forecast...', 'Benchmarking against NACS...', 'Generating 5-year projection...'];
  useEffect(() => {
    const t = setInterval(() => setStep(s => {
      if (s >= steps.length - 1) { clearInterval(t); setTimeout(onComplete, 600); return s; }
      return s + 1;
    }), 450);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#000", color: "#fff", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ fontSize: 12, fontWeight: 700, color: "#444", letterSpacing: "0.15em", marginBottom: 24 }}>RUNNING FORECAST</div>
      <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 40, textAlign: "center" }}>{siteName}</h1>
      <div style={{ maxWidth: 400, width: "100%" }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", opacity: i <= step ? 1 : 0.15, transition: "opacity 0.4s ease" }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: i < step ? "#fff" : i === step ? "#888" : "#222", transition: "background 0.3s", flexShrink: 0 }} />
            <span style={{ fontSize: 14, color: i <= step ? "#fff" : "#333", fontWeight: i === step ? 600 : 400, transition: "all 0.3s" }}>{s}</span>
            {i < step && <span style={{ fontSize: 11, color: "#444", marginLeft: "auto" }}>✓</span>}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 40, width: 200, height: 2, background: "#222", overflow: "hidden" }}>
        <div style={{ width: `${((step + 1) / steps.length) * 100}%`, height: "100%", background: "#fff", transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState("landing");
  const [vertical, setVertical] = useState(null);
  const [tier, setTier] = useState(null);
  const [siteCount, setSiteCount] = useState(1);
  const [formData, setFormData] = useState({});
  const [activeSection, setActiveSection] = useState(0);
  const [forecast, setForecast] = useState(null);
  const bodyRef = useRef(null);
  const topRef = useRef(null);

  const discount = siteCount >= 10 ? 0.35 : siteCount >= 5 ? 0.25 : siteCount >= 2 ? 0.15 : 0;
  const discountLabel = siteCount >= 10 ? "35% off" : siteCount >= 5 ? "25% off" : siteCount >= 2 ? "15% off" : null;

  const scrollTop = () => { topRef.current?.scrollIntoView({ behavior: "smooth" }); };
  const handleChange = (n, v) => setFormData(p => ({ ...p, [n]: v }));
  const show = (ft) => tierOrder[ft] <= (tierOrder[tier] ?? 0);

  const goVertical = (id) => { setVertical(id); setPage("tier"); scrollTop(); };
  const goForm = (t) => { setTier(t); setPage("form"); setActiveSection(0); setFormData({}); scrollTop(); };
  const goLanding = () => { setPage("landing"); setVertical(null); setTier(null); setSiteCount(1); setFormData({}); setActiveSection(0); setForecast(null); scrollTop(); };

  const submitForecast = () => {
    const f = runForecast(formData, vertical);
    setForecast(f);
    setPage("processing");
  };

  const vDef = vertical ? VF[vertical] : null;
  const scenarioSection = { id: "scenarios", title: "Scenario Analysis", n: "SA", fields: SCENARIO_FIELDS };
  const allSections = vDef ? [
    { id: "site", title: "Site Information", n: "00", fields: SHARED_SITE },
    ...vDef.sections,
    { id: "traffic", title: "Traffic & Demographics", n: String(vDef.sections.length + 1).padStart(2,"0"), fields: SHARED_TRAFFIC },
    ...(tier === "decision" ? [scenarioSection] : []),
  ] : [];
  const visSections = allSections.map(s => ({ ...s, fields: s.fields.filter(f => show(f.tier)) })).filter(s => s.fields.length > 0);
  const totalF = visSections.reduce((a, s) => a + s.fields.filter(f => f.type !== "helper" && !(f.hideIf && formData[f.hideIf])).length, 0);
  const filledF = visSections.reduce((a, s) => a + s.fields.filter(f => f.type !== "helper" && !(f.hideIf && formData[f.hideIf])).filter(f => { const v = formData[f.name]; return v !== undefined && v !== "" && v !== false; }).length, 0);
  const progress = totalF > 0 ? Math.round((filledF / totalF) * 100) : 0;
  const vMeta = VERTICALS.find(v => v.id === vertical);

  const base = { fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#000", color: "#fff", lineHeight: 1.6, overflowX: "hidden", minHeight: "100vh" };
  const btn = (primary) => ({ padding: primary ? "1.25rem 3rem" : "0.75rem 1.5rem", background: primary ? "#fff" : "transparent", color: primary ? "#000" : "#999", border: primary ? "none" : "1px solid #222", fontWeight: primary ? 700 : 600, fontSize: primary ? "1.1rem" : "0.9rem", cursor: "pointer", transition: "all 0.3s ease", textDecoration: "none", display: "inline-block", letterSpacing: "-0.01em", fontFamily: "'Inter', sans-serif" });

  // ═══════════════ RESULTS ═══════════════
  if (page === "results" && forecast) {
    return <ResultsDashboard forecast={forecast} formData={formData} vertical={vertical} tier={tier} goLanding={goLanding} />;
  }

  // ═══════════════ PROCESSING ═══════════════
  if (page === "processing") {
    return <ProcessingScreen siteName={formData.projectName || formData.crossStreets || formData.address || 'Your Site'} onComplete={() => setPage("results")} />;
  }

  // ═══════════════ LANDING PAGE (Midnight Executive) ═══════════════
  const T = { bg: '#0a0a0f', bg2: '#111118', bg3: '#1a1a24', surface: '#16161e', surfaceHover: '#1e1e28', border: '#252530', borderLight: '#333340', text: '#e8e8f0', textMuted: '#8888a0', textDim: '#555568', accent: '#d4a853', accentLight: '#e8c878', accentDark: '#b08930' };
  const lBtn = (primary) => ({ padding: primary ? "14px 36px" : "0.75rem 1.5rem", background: primary ? T.accent : "transparent", color: primary ? T.bg : T.textMuted, border: primary ? "none" : `1px solid ${T.borderLight}`, fontWeight: primary ? 700 : 600, fontSize: primary ? "1.1rem" : "0.9rem", cursor: "pointer", transition: "all 0.3s ease", textDecoration: "none", display: "inline-block", letterSpacing: "0.01em", fontFamily: "'Inter', sans-serif" });

  if (page === "landing") {
    return (
      <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: T.bg, color: T.text, lineHeight: 1.6, overflowX: "hidden", minHeight: "100vh", display: "flex", flexDirection: "column" }} ref={topRef}>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

        {/* Nav */}
        <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1rem 5%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, background: `linear-gradient(135deg, ${T.accent}, ${T.accentDark})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: T.bg }}>R</div>
              <span style={{ fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>RunSiteScratch</span>
            </div>
            <button onClick={() => setPage("verticals")} style={lBtn(true)}
              onMouseEnter={e => { e.currentTarget.style.background = T.accentLight; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = T.accent; e.currentTarget.style.transform = "translateY(0)"; }}
            >Start Forecast</button>
          </div>
        </nav>

        {/* Hero */}
        <section style={{ position: "relative", padding: "10rem 5% 6rem", maxWidth: 1200, margin: "0 auto", width: "100%" }}>
          {/* Grid background */}
          <div style={{ position: "absolute", inset: 0, opacity: 0.04, backgroundImage: `linear-gradient(rgba(212,168,83,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(212,168,83,0.5) 1px, transparent 1px)`, backgroundSize: "60px 60px", pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translate(-50%,-50%)", width: 600, height: 600, borderRadius: "50%", background: `radial-gradient(circle, rgba(212,168,83,0.06) 0%, transparent 70%)`, pointerEvents: "none" }} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <h1 style={{ fontSize: "clamp(3rem, 8vw, 7rem)", fontWeight: 900, lineHeight: 0.95, letterSpacing: "-0.04em", marginBottom: "2rem", color: T.text }}>Run the<br/>numbers<br/>before you<br/>break ground.</h1>
            <p style={{ fontSize: "clamp(1.25rem, 3vw, 2rem)", fontWeight: 300, color: T.textMuted, marginBottom: "3rem", letterSpacing: "-0.01em" }}>Fast site screening. Conservative baselines. Professional analyst results.</p>
            <button onClick={() => setPage("verticals")} style={lBtn(true)}
              onMouseEnter={e => { e.currentTarget.style.background = T.accentLight; e.currentTarget.style.transform = "translateY(-3px)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = T.accent; e.currentTarget.style.transform = "translateY(0)"; }}
            >Get Started →</button>
          </div>
        </section>

        {/* How It Works */}
        <section style={{ padding: "8rem 5%", borderTop: `1px solid ${T.border}` }}>
          <h2 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", fontWeight: 800, textAlign: "center", marginBottom: "4rem", letterSpacing: "-0.03em", color: T.text }}>How It Works</h2>
          <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "3rem" }}>
            {[{ n: "01", t: "Choose Your Vertical", d: "C-Store, Travel Center, QSR, Car Wash — pick your format." },
              { n: "02", t: "Enter Site Details", d: "Address, traffic, competition. We auto-fill what we can." },
              { n: "03", t: "Get Your Forecast", d: "Fuel volumes, inside sales, 5-year P&L — benchmarked against NACS." }
            ].map(s => (
              <div key={s.n}>
                <div style={{ fontSize: "3rem", fontWeight: 900, color: T.border, marginBottom: "1rem" }}>{s.n}</div>
                <h3 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.75rem", color: T.text }}>{s.t}</h3>
                <p style={{ color: T.textDim, fontSize: "1rem", fontWeight: 300 }}>{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Verticals */}
        <section style={{ padding: "6rem 5%", borderTop: `1px solid ${T.border}`, background: T.bg2 }}>
          <h2 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", fontWeight: 800, textAlign: "center", marginBottom: "1rem", letterSpacing: "-0.03em", color: T.text }}>7 Verticals</h2>
          <p style={{ textAlign: "center", color: T.textDim, fontSize: "1.1rem", fontWeight: 300, marginBottom: "3rem" }}>Purpose-built forecast models for each format.</p>
          <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {VERTICALS.map(v => (
              <div key={v.id} onClick={() => goVertical(v.id)} style={{ padding: "1.5rem", border: `1px solid ${T.border}`, background: T.surface, cursor: "pointer", transition: "all 0.3s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.surfaceHover; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.surface; }}>
                <h4 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 4, color: T.text }}>{v.label}</h4>
                <p style={{ fontSize: "0.85rem", color: T.textDim, margin: 0 }}>{v.sub}</p>
                <div style={{ fontSize: "0.8rem", color: T.accent, marginTop: 8, fontWeight: 600 }}>{v.price}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section style={{ padding: "8rem 5%", borderTop: `1px solid ${T.border}` }}>
          <h2 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", fontWeight: 800, textAlign: "center", marginBottom: "1.5rem", letterSpacing: "-0.03em", color: T.text }}>Simple Pricing</h2>
          <p style={{ textAlign: "center", color: T.textDim, fontSize: "1.1rem", fontWeight: 300, marginBottom: "4rem", maxWidth: 600, margin: "0 auto 4rem" }}>Pay per forecast. No subscriptions. Volume discounts available.</p>
          <div style={{ maxWidth: 960, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem" }}>
            {[{ t: "Quick Scan", p: "$35–50", d: "~3 min · Rough baseline" }, { t: "Standard", p: "$50–75", d: "~8 min · Credible forecast" }, { t: "Pro Detail", p: "$75–125", d: "~15 min · Investment-grade" }, { t: "Decision Package", p: "$149–199", d: "~20 min · 3 scenarios + comparison" }].map(p => (
              <div key={p.t} style={{ padding: "2rem", border: p.t === "Decision Package" ? `1px solid ${T.accent}` : p.t === "Standard" ? `1px solid ${T.accentLight}` : `1px solid ${T.border}`, background: T.surface, textAlign: "center", position: "relative" }}>
                {p.t === "Standard" && <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.1em", marginBottom: 8 }}>MOST POPULAR</div>}
                {p.t === "Decision Package" && <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.1em", marginBottom: 8 }}>MOST COMPREHENSIVE</div>}
                <h4 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem", color: T.text }}>{p.t}</h4>
                <div style={{ fontSize: "1.75rem", fontWeight: 900, marginBottom: "0.5rem", letterSpacing: "-0.02em", color: T.text }}>{p.p}</div>
                <p style={{ fontSize: "0.85rem", color: T.textDim }}>{p.d}</p>
              </div>
            ))}
          </div>

          {/* Volume Discounts */}
          <div style={{ maxWidth: 700, margin: "3rem auto 0", padding: "2.5rem", border: `1px solid ${T.border}`, background: T.bg2 }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 800, textAlign: "center", marginBottom: "0.5rem", letterSpacing: "-0.02em", color: T.text }}>Multi-Site Volume Discounts</h3>
            <p style={{ textAlign: "center", color: T.textDim, fontSize: "0.85rem", marginBottom: "1.5rem" }}>Order multiple sites in a single order and save.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, textAlign: "center" }}>
              <div style={{ padding: "1rem", borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: "0.7rem", color: T.textDim, fontWeight: 600, letterSpacing: "0.05em", marginBottom: 4 }}>SITES</div>
              </div>
              <div style={{ padding: "1rem", borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: "0.7rem", color: T.textDim, fontWeight: 600, letterSpacing: "0.05em", marginBottom: 4 }}>DISCOUNT</div>
              </div>
              <div style={{ padding: "1rem", borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: "0.7rem", color: T.textDim, fontWeight: 600, letterSpacing: "0.05em", marginBottom: 4 }}>EXAMPLE</div>
              </div>
              {[
                { sites: "2–4 sites", pct: "15% off", ex: "Standard: $43–64/ea" },
                { sites: "5–9 sites", pct: "25% off", ex: "Standard: $38–56/ea" },
                { sites: "10+ sites", pct: "35% off", ex: "Standard: $33–49/ea" },
              ].map((r, i) => (
                <>
                  <div key={`s${i}`} style={{ padding: "0.75rem 1rem", borderBottom: i < 2 ? `1px solid ${T.bg3}` : "none" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.95rem", color: T.text }}>{r.sites}</span>
                  </div>
                  <div key={`p${i}`} style={{ padding: "0.75rem 1rem", borderBottom: i < 2 ? `1px solid ${T.bg3}` : "none" }}>
                    <span style={{ fontWeight: 900, fontSize: "1.1rem", color: i === 2 ? T.accent : T.text }}>{r.pct}</span>
                  </div>
                  <div key={`e${i}`} style={{ padding: "0.75rem 1rem", borderBottom: i < 2 ? `1px solid ${T.bg3}` : "none" }}>
                    <span style={{ fontSize: "0.85rem", color: T.textMuted }}>{r.ex}</span>
                  </div>
                </>
              ))}
            </div>
            <p style={{ textAlign: "center", color: T.textDim, fontSize: "0.75rem", marginTop: "1rem" }}>Discount applies to all tiers. All sites in one order, any mix of verticals.</p>
          </div>
        </section>

        {/* Final CTA */}
        <section style={{ padding: "10rem 5%", textAlign: "center", borderTop: `1px solid ${T.border}`, position: "relative" }}>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 500, height: 500, borderRadius: "50%", background: `radial-gradient(circle, rgba(212,168,83,0.04) 0%, transparent 70%)`, pointerEvents: "none" }} />
          <h2 style={{ fontSize: "clamp(2.5rem, 6vw, 5rem)", fontWeight: 900, marginBottom: "1.5rem", lineHeight: 1.1, letterSpacing: "-0.03em", color: T.text, position: "relative" }}>Ready to run<br/>your first forecast?</h2>
          <button onClick={() => setPage("verticals")} style={{ ...lBtn(true), position: "relative" }}
            onMouseEnter={e => { e.currentTarget.style.background = T.accentLight; e.currentTarget.style.transform = "translateY(-3px)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = T.accent; e.currentTarget.style.transform = "translateY(0)"; }}
          >Get Started</button>
        </section>

        {/* SEO Content Section — FAQ & Industry Context */}
        <section style={{ padding: "6rem 5%", borderTop: `1px solid ${T.border}`, maxWidth: 900, margin: "0 auto" }}>
          <h2 style={{ fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 800, textAlign: "center", marginBottom: "1rem", letterSpacing: "-0.03em", color: T.text }}>Revenue Projections for New Retail Developments</h2>
          <p style={{ textAlign: "center", color: T.textMuted, fontSize: "1.05rem", marginBottom: "4rem", lineHeight: 1.6 }}>
            RunSiteScratch provides site-specific sales projections, fuel volume estimates, and financial forecasts for convenience stores, gas stations, travel centers, restaurants, and specialty retail concepts across the United States.
          </p>

          <div style={{ marginBottom: "3rem" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "0.75rem", color: T.text }}>How much does a new gas station sell per month?</h3>
            <p style={{ color: T.textMuted, lineHeight: 1.7, fontSize: "0.95rem" }}>
              According to NACS 2024 industry data, the average U.S. convenience store with fuel generates approximately 117,000 gallons of gasoline per month and $184,000 in monthly in-store sales. However, actual volumes vary dramatically based on AADT traffic counts, site access configuration, competitive density, trade area demographics, store square footage, and foodservice program. A rural highway store on a 10,000 AADT two-lane road will perform very differently from an urban freeway frontage road location with 40,000 AADT. RunSiteScratch builds site-specific projections that account for these variables rather than relying on national averages alone.
            </p>
          </div>

          <div style={{ marginBottom: "3rem" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "0.75rem", color: T.text }}>What AADT do you need for a profitable convenience store?</h3>
            <p style={{ color: T.textMuted, lineHeight: 1.7, fontSize: "0.95rem" }}>
              There is no single AADT threshold that guarantees profitability — it depends on site access, intersection configuration, competitive landscape, store format, and operating costs. That said, most lenders and developers look for a minimum of 12,000–15,000 AADT on the primary road for a conventional gas station and convenience store. Travel centers with truck diesel typically require higher counts and a meaningful truck percentage (5%+ of AADT). RunSiteScratch uses a proprietary density classifier that evaluates AADT alongside population, household density, and vehicle registrations to project fuel capture rates specific to your site.
            </p>
          </div>

          <div style={{ marginBottom: "3rem" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "0.75rem", color: T.text }}>Gas station feasibility study vs. revenue projection — what's the difference?</h3>
            <p style={{ color: T.textMuted, lineHeight: 1.7, fontSize: "0.95rem" }}>
              A full feasibility study typically costs $15,000–$50,000 and includes environmental assessments, engineering studies, zoning analysis, and detailed financial modeling. RunSiteScratch provides the revenue projection component — estimated fuel volumes, convenience store sales, foodservice revenue, and gross profit — at a fraction of the cost. Our projections are designed for early-stage site screening, lender conversations, and investment evaluation. They complement but do not replace a formal feasibility study for final investment commitment.
            </p>
          </div>

          <div style={{ marginBottom: "3rem" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "0.75rem", color: T.text }}>What types of businesses can RunSiteScratch forecast?</h3>
            <p style={{ color: T.textMuted, lineHeight: 1.7, fontSize: "0.95rem" }}>
              We build revenue projections for seven retail verticals: convenience stores with fuel (c-store and gas station), travel centers and truck stops with diesel, QSR and fast food restaurants, grocery markets and carnicerías, standalone liquor stores, express car washes, and laundromats. Each vertical uses purpose-built forecast models calibrated to industry-specific benchmarks — NACS for c-stores, NATSO for travel centers, NRA for restaurants — rather than generic financial templates.
            </p>
          </div>

          <div style={{ marginBottom: "3rem" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "0.75rem", color: T.text }}>How are convenience store profit margins calculated?</h3>
            <p style={{ color: T.textMuted, lineHeight: 1.7, fontSize: "0.95rem" }}>
              Convenience store gross margins vary by product category. Fuel margins typically run $0.20–$0.30 per gallon, while in-store merchandise carries a blended margin of 28–33%. Foodservice and prepared food is the highest-margin category at 40–55%, which is why c-store operators increasingly invest in kitchen programs. Dispensed beverages (fountain drinks, coffee) carry margins of 70–80%. Our projections break down revenue by category — tobacco, packaged beverages, beer and wine, snacks, foodservice, dispensed beverages, and general merchandise — so you can model gross profit accurately rather than applying a single blended margin.
            </p>
          </div>

          <div style={{ marginBottom: "3rem" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "0.75rem", color: T.text }}>How much diesel does a truck stop sell per month?</h3>
            <p style={{ color: T.textMuted, lineHeight: 1.7, fontSize: "0.95rem" }}>
              Diesel volume at travel centers and truck stops varies enormously based on highway truck traffic, number of hi-flow diesel lanes, DEF availability, and competitive proximity to other truck stops. A well-positioned travel center on an interstate with dedicated truck infrastructure can sell 200,000–500,000+ gallons of diesel per month. A convenience store with standard diesel hoses (not hi-flow) on a secondary highway might sell 5,000–15,000 gallons. The key variables are truck AADT percentage, segregated truck lane infrastructure, and distance to the nearest competing truck diesel facility.
            </p>
          </div>

          <div style={{ marginBottom: "3rem" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "0.75rem", color: T.text }}>Do you provide projections for SBA loans and lender packages?</h3>
            <p style={{ color: T.textMuted, lineHeight: 1.7, fontSize: "0.95rem" }}>
              Yes. Our Standard and Pro Detail tier reports are formatted for inclusion in SBA loan applications, lender presentation packages, and investor pitch decks. Each report includes projected monthly fuel volumes (gasoline and diesel), convenience store sales by category, foodservice revenue, gross profit estimates, and a detailed analysis of the competitive landscape, trade area demographics, and growth catalysts. Reports are delivered as professionally formatted documents ready for lender review.
            </p>
          </div>

          <div style={{ marginBottom: "3rem" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "0.75rem", color: T.text }}>What is the Decision Package?</h3>
            <p style={{ color: T.textMuted, lineHeight: 1.7, fontSize: "0.95rem" }}>
              The Decision Package ($149–$199) is our most comprehensive report tier. Instead of a single projection, it delivers three complete forecast scenarios — your base case plus two alternative scenarios you define — with a side-by-side comparison table and an analyst recommendation narrative. Typical scenario pairs include: base case vs. enhanced foodservice, base case vs. competitive entry by a major chain, or expanded diesel infrastructure vs. standard format. The Decision Package is designed for final go/no-go investment decisions where you need to see how the numbers change under different operating assumptions or market conditions. It includes everything in the Pro Detail tier plus the multi-scenario analysis.
            </p>
          </div>

          <div style={{ marginBottom: "3rem" }}>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "0.75rem", color: T.text }}>What data sources do you use?</h3>
            <p style={{ color: T.textMuted, lineHeight: 1.7, fontSize: "0.95rem" }}>
              RunSiteScratch projections are built on NACS State of the Industry benchmarks, MMCG national fuel volume data, U.S. Census Bureau demographics (ACS 5-Year estimates), state DOT traffic counts (AADT), competitive market analysis from business listings and consumer reviews, and proprietary models calibrated across hundreds of site evaluations. We do not use generic templates — every projection is built site-by-site based on the specific trade area, competitive set, and facility configuration.
            </p>
          </div>

          <div>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "0.75rem", color: T.text }}>How much does a RunSiteScratch projection cost?</h3>
            <p style={{ color: T.textMuted, lineHeight: 1.7, fontSize: "0.95rem" }}>
              Projections start at $35 for a Quick Scan (rough baseline for initial site screening) and range to $75–$125 for a Pro Detail report with full competitive analysis, demographic deep-dive, and foodservice modeling. Our Decision Package ($149–$199) delivers three complete forecast scenarios with a side-by-side comparison table and analyst recommendation — ideal for final go/no-go investment decisions and investor presentations. There are no subscriptions or monthly fees — you pay per projection. Multi-site volume discounts are available: 15% off for 2–4 sites, 25% off for 5–9 sites, and 35% off for 10 or more sites in a single order — any mix of verticals and tiers. Most customers use the Quick Scan to screen 5–10 candidate sites, then run Standard or Pro Detail reports on their top 2–3 finalists.
            </p>
          </div>
        </section>

        <footer style={{ padding: "4rem 5%", borderTop: `1px solid ${T.border}`, textAlign: "center" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: "1rem" }}>
              <div style={{ width: 24, height: 24, background: `linear-gradient(135deg, ${T.accent}, ${T.accentDark})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: T.bg }}>R</div>
              <span style={{ fontSize: "1.25rem", fontWeight: 800, color: T.text }}>RunSiteScratch</span>
            </div>
            <div style={{ width: "100%", marginTop: "1rem", paddingTop: "1rem", borderTop: `1px solid ${T.border}`, color: T.textDim, fontSize: "0.85rem" }}>© 2026 RunSiteScratch. All rights reserved.</div>
          </div>
        </footer>
      </div>
    );
  }

  // ═══════════════ VERTICAL SELECTION ═══════════════
  if (page === "verticals") {
    return (
      <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: T.bg, color: T.text, lineHeight: 1.6, overflowX: "hidden", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <header style={{ padding: "2rem 5%", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={goLanding}>
            <div style={{ width: 32, height: 32, background: `linear-gradient(135deg, ${T.accent}, ${T.accentDark})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: T.bg }}>R</div>
            <span style={{ fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>RunSiteScratch</span>
          </div>
        </header>
        <div style={{ padding: "6rem 5%", maxWidth: 800, margin: "0 auto", width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: "3rem", color: T.text }}>Choose Your Vertical</h1>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, textAlign: "left" }}>
            {VERTICALS.map(v => (
              <div key={v.id} onClick={() => goVertical(v.id)} style={{ padding: "1.5rem", border: `1px solid ${T.border}`, background: T.surface, cursor: "pointer", transition: "all 0.3s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.surfaceHover; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.surface; }}>
                <h4 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4, color: T.text }}>{v.label}</h4>
                <p style={{ fontSize: "0.85rem", color: T.textDim, margin: 0 }}>{v.sub}</p>
                <div style={{ fontSize: "0.8rem", color: T.accent, marginTop: 8, fontWeight: 600 }}>{v.price}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════ TIER SELECTION ═══════════════
  if (page === "tier") {
    // Price ranges as [low, high] for each tier
    const priceRanges = { quick: [35,50], standard: [50,75], pro: [75,125], decision: [149,199] };
    const fmtPrice = (id) => {
      const [lo, hi] = priceRanges[id];
      if (discount > 0) {
        const dLo = Math.round(lo * (1 - discount));
        const dHi = Math.round(hi * (1 - discount));
        return { original: `$${lo}–${hi}`, discounted: `$${dLo}–${dHi}` };
      }
      return { original: `$${lo}–${hi}`, discounted: null };
    };
    return (
      <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: T.bg, color: T.text, lineHeight: 1.6, overflowX: "hidden", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <header style={{ padding: "2rem 5%", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={goLanding}>
            <div style={{ width: 32, height: 32, background: `linear-gradient(135deg, ${T.accent}, ${T.accentDark})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: T.bg }}>R</div>
            <span style={{ fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>RunSiteScratch</span>
          </div>
          <span style={{ color: T.textMuted, fontSize: "0.9rem" }}>{vMeta?.label}</span>
        </header>
        <div style={{ padding: "6rem 5%", maxWidth: 900, margin: "0 auto", width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: "1.5rem", color: T.text }}>Select Tier</h1>

          {/* Site Count Selector */}
          <div style={{ maxWidth: 400, margin: "0 auto 3rem", padding: "1.25rem 2rem", border: `1px solid ${T.border}`, background: T.bg2, display: "flex", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
            <span style={{ fontSize: "0.85rem", color: T.textMuted, fontWeight: 500 }}>Sites in this order:</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setSiteCount(Math.max(1, siteCount - 1))} style={{ width: 32, height: 32, background: T.surface, border: `1px solid ${T.borderLight}`, color: T.text, fontSize: 18, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
              <span style={{ fontSize: "1.5rem", fontWeight: 900, minWidth: 36, textAlign: "center", color: T.text }}>{siteCount}</span>
              <button onClick={() => setSiteCount(siteCount + 1)} style={{ width: 32, height: 32, background: T.surface, border: `1px solid ${T.borderLight}`, color: T.text, fontSize: 18, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
            </div>
            {discountLabel && <span style={{ fontSize: "0.85rem", fontWeight: 800, color: T.accent, padding: "3px 10px", border: `1px solid ${T.accent}` }}>{discountLabel}</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem" }}>
            {TIERS.map(t => {
              const p = fmtPrice(t.id);
              return (
              <div key={t.id} onClick={() => goForm(t.id)} style={{ padding: "2rem", border: t.id === "decision" ? `1px solid ${T.accent}` : t.id === "standard" ? `1px solid ${T.accentLight}` : `1px solid ${T.border}`, background: T.surface, cursor: "pointer", transition: "all 0.3s", textAlign: "left" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.surfaceHover; }} onMouseLeave={e => { e.currentTarget.style.borderColor = t.id === "decision" ? T.accent : t.id === "standard" ? T.accentLight : T.border; e.currentTarget.style.background = T.surface; }}>
                {t.id === "standard" && <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.1em", marginBottom: 8 }}>MOST POPULAR</div>}
                {t.badge && <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.1em", marginBottom: 8 }}>{t.badge}</div>}
                <h3 style={{ fontSize: "1.25rem", fontWeight: 800, marginBottom: 8, color: T.text }}>{t.label}</h3>
                {p.discounted ? (
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: "1rem", color: T.textDim, textDecoration: "line-through", marginRight: 8 }}>{p.original}</span>
                    <span style={{ fontSize: "1.75rem", fontWeight: 900, letterSpacing: "-0.02em", color: T.accent }}>{p.discounted}</span>
                  </div>
                ) : (
                  <div style={{ fontSize: "1.75rem", fontWeight: 900, marginBottom: 8, letterSpacing: "-0.02em", color: T.text }}>{p.original}</div>
                )}
                <p style={{ fontSize: "0.85rem", color: T.textDim, lineHeight: 1.5 }}>{t.desc}</p>
                <div style={{ fontSize: "0.8rem", color: T.textMuted, marginTop: 12 }}>{t.time}</div>
              </div>
              );
            })}
          </div>
          <button onClick={() => setPage("verticals")} style={{ ...lBtn(false), marginTop: "2rem" }}>← Change Vertical</button>
        </div>
      </div>
    );
  }

  // ═══════════════ MAIN FORM ═══════════════
  return (
    <div style={{ ...base, display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <header style={{ padding: "1.25rem 5%", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #222", position: "sticky", top: 0, zIndex: 20, background: "#000" }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em", cursor: "pointer" }} onClick={goLanding}>RunSiteScratch</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: "#666" }}>{vMeta?.label}</span>
          <span style={{ fontSize: 11, color: "#999", fontWeight: 600, padding: "4px 10px", border: "1px solid #222" }}>{TIERS.find(t=>t.id===tier)?.label}</span>
        </div>
      </header>

      {/* Progress */}
      <div style={{ borderBottom: "1px solid #222", padding: "10px 5%" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ flex: 1, height: 2, background: "#222", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "#fff", transition: "width 0.3s" }} /></div>
          <span style={{ fontSize: 12, color: "#666", fontWeight: 500 }}>{progress}%</span>
        </div>
      </div>

      <div style={{ display: "flex", maxWidth: 1100, margin: "0 auto", width: "100%", flex: 1 }}>
        {/* Sidebar */}
        <nav style={{ width: 220, flexShrink: 0, borderRight: "1px solid #222", padding: "1.5rem 0", overflowY: "auto" }}>
          <button onClick={() => setPage("tier")} style={{ display: "block", background: "none", border: "none", color: "#666", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "'Inter'", padding: "6px 1.5rem", marginBottom: "1rem" }}>← Change Tier</button>
          {visSections.map((s, i) => (
            <div key={s.id} onClick={() => { setActiveSection(i); bodyRef.current?.scrollTo(0,0); }} style={{
              padding: "10px 1.5rem", cursor: "pointer", transition: "all 0.3s ease",
              borderRight: activeSection === i ? "1px solid #fff" : "1px solid transparent",
              background: activeSection === i ? "#0a0a0a" : "transparent",
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: activeSection === i ? "#fff" : "#444", letterSpacing: "0.1em", marginRight: 8 }}>{s.n}</span>
              <span style={{ fontSize: 13, fontWeight: activeSection === i ? 700 : 400, color: activeSection === i ? "#fff" : "#666" }}>{s.title}</span>
            </div>
          ))}
        </nav>

        {/* Body */}
        <main ref={bodyRef} style={{ flex: 1, overflowY: "auto", padding: "2rem 3rem 8rem" }}>
          {visSections[activeSection] && (() => {
            const sec = visSections[activeSection];
            const toggles = sec.fields.filter(f => f.type === "toggle");
            const rest = sec.fields.filter(f => f.type !== "toggle");
            return (<div>
              <div style={{ marginBottom: "1.5rem" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#666", letterSpacing: "0.1em" }}>{sec.n}</span>
                <h2 style={{ fontSize: "1.75rem", fontWeight: 800, margin: "4px 0 0", letterSpacing: "-0.02em" }}>{sec.title}</h2>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
                {rest.map(f => <Field key={f.name} field={f} value={formData[f.name]} onChange={handleChange} allValues={formData} />)}
              </div>
              {toggles.length > 0 && (<div style={{ borderTop: "1px solid #222", paddingTop: 16, marginTop: 8, display: "flex", flexWrap: "wrap", gap: "4px 28px" }}>
                {toggles.map(f => <Field key={f.name} field={f} value={formData[f.name]} onChange={handleChange} allValues={formData} />)}
              </div>)}
            </div>);
          })()}
        </main>
      </div>

      {/* Footer */}
      <div style={{ position: "sticky", bottom: 0, background: "#000", borderTop: "1px solid #222", padding: "1rem 5%", zIndex: 20 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {activeSection > 0 ? (
            <button onClick={() => { setActiveSection(a => a - 1); bodyRef.current?.scrollTo(0,0); }} style={btn(false)}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#fff"} onMouseLeave={e => e.currentTarget.style.borderColor = "#222"}>← Back</button>
          ) : <div />}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 13, color: "#666" }}>{activeSection + 1} / {visSections.length}</span>
            {activeSection < visSections.length - 1 ? (
              <button onClick={() => { setActiveSection(a => a + 1); bodyRef.current?.scrollTo(0,0); }} style={btn(true)}
                onMouseEnter={e => { e.currentTarget.style.background = "#ddd"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.transform = "translateY(0)"; }}
              >Continue →</button>
            ) : (
              <button onClick={submitForecast} style={btn(true)}
                onMouseEnter={e => { e.currentTarget.style.background = "#ddd"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.transform = "translateY(0)"; }}
              >Run Forecast →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
