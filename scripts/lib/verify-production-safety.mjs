export function evaluateProductionSafety(status) {
  const failures = [];
  if (status?.emergencyStopValid !== true) failures.push('D1 emergency-stop state is missing or invalid');
  if (status?.emergencyStop !== true) failures.push('D1 emergency stop is not active');
  if (status?.publishingEnabled !== false) failures.push('immediate publishing is enabled');
  if (status?.schedulingEnabled !== false) failures.push('scheduling is enabled');
  if (status?.operationWindow?.active === true) failures.push('an operation window is active');
  return failures;
}
