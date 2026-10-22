export type ModifyTimeSortDirection = "asc" | "desc";

/**
 * 按修改时间排序的比较函数，主 SFTP 面板与文件传输弹窗共用。
 * 缺少修改时间的项目固定排在末尾，切换方向时不参与翻转。
 */
export function compareByModifyTime(direction: ModifyTimeSortDirection) {
  return (
    left: { modifyTime?: number },
    right: { modifyTime?: number },
  ): number => {
    const leftTime = left.modifyTime;
    const rightTime = right.modifyTime;

    if (typeof leftTime !== "number") {
      return typeof rightTime === "number" ? 1 : 0;
    }
    if (typeof rightTime !== "number") {
      return -1;
    }

    return direction === "asc" ? leftTime - rightTime : rightTime - leftTime;
  };
}

export function toggleModifyTimeSortDirection(
  direction: ModifyTimeSortDirection,
): ModifyTimeSortDirection {
  return direction === "asc" ? "desc" : "asc";
}
