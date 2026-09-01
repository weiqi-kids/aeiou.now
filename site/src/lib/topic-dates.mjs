// Topic 日期的排序規則集中在這裡，讓逐國頁與測試共用同一份判準。
// 日期是「地方時區的日曆日」，只比較匯出層已經算好的 starts_on，不在顯示層
// 重新解析 date_rule，也不拿已格式化的多語日期字串排序。

/**
 * 依下一次實際發生日期排序 observance；沒有日期的項目穩定地排在最後。
 * @param {Array<object>} observances
 * @returns {Array<object>}
 */
export function sortByOccurrenceStart(observances) {
  return (Array.isArray(observances) ? observances : [])
    .map((observance, index) => ({ observance, index }))
    .sort((a, b) => {
      const aStart = a.observance?.next_occurrence?.starts_on || '';
      const bStart = b.observance?.next_occurrence?.starts_on || '';
      if (!aStart && !bStart) return a.index - b.index;
      if (!aStart) return 1;
      if (!bStart) return -1;
      return aStart.localeCompare(bStart) || a.index - b.index;
    })
    .map(({ observance }) => observance);
}
