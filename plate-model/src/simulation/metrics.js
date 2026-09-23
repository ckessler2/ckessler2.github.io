export function estimateResultMemoryBytes(result) {
  const series = [
    result.t,
    result.states.v_xp,
    result.states.v_yp,
    result.states.omega,
    result.states.theta,
    result.states.x,
    result.states.y,
  ];

  return series.reduce((sum, values) => sum + values.length * 8, 0);
}
