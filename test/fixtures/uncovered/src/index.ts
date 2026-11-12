import _ from "lodash";
export const debounce = (fn: () => void) => _.debounce(fn, 100);
