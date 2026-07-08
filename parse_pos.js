function getPositionSize(positionSize, balance, buyPrice) {
  let computedShares = 1;
  const psStr = (positionSize || "1").toString().trim();
  if (psStr.endsWith("%")) {
    const pct = parseFloat(psStr.replace("%", ""));
    const maxCash = balance * (pct / 100);
    computedShares = Math.max(1, Math.floor(maxCash / buyPrice));
  } else {
    computedShares = parseInt(psStr) || 1;
  }
  return computedShares;
}
console.log(getPositionSize("10%", 10000, 10));
console.log(getPositionSize("50", 10000, 10));
console.log(getPositionSize("1", 10000, 10));
