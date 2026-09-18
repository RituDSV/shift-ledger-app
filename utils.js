// utils.js — small pieces shared by the rep and master routers.

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const LEVELS = ["UG", "PG"];

function hourLabel(h) {
  const to12 = (n) => {
    const hh = n % 12 === 0 ? 12 : n % 12;
    return `${hh}:00 ${n < 12 ? "AM" : "PM"}`;
  };
  return `${to12(h)} – ${to12(h + 1)}`;
}

module.exports = { HOURS, DATE_RE, MONTH_RE, LEVELS, hourLabel };
