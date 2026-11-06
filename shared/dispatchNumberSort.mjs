export const dispatchNumberSortOptions = [
  { value: 'dispatch-desc', label: '派工号从大到小' },
  { value: 'dispatch-asc', label: '派工号从小到大' }
];

function compareText(left, right) {
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

export function compareDispatchNumbers(a, b, sort = 'dispatch-desc') {
  const left = (a.dispatchNo || '').trim().toUpperCase();
  const right = (b.dispatchNo || '').trim().toUpperCase();
  if (!left || !right) return Number(!left) - Number(!right);

  // Compare significant digits without rounding long serial numbers.
  const leftDigits = left.match(/[0-9]+$/)?.[0].replace(/^0+/, '');
  const rightDigits = right.match(/[0-9]+$/)?.[0].replace(/^0+/, '');
  if (leftDigits === undefined && rightDigits !== undefined) return 1;
  if (rightDigits === undefined && leftDigits !== undefined) return -1;

  let numeric = 0;
  if (leftDigits !== undefined && rightDigits !== undefined) {
    numeric = leftDigits.length - rightDigits.length || compareText(leftDigits, rightDigits);
  }
  const result = numeric || compareText(left, right);
  return sort === 'dispatch-asc' ? result : -result;
}
