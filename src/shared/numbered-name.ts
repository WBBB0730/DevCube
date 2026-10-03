/**
 * 重名默认名的编号格式（全应用统一）：第一个就叫 base，之后「base (2) / base (3) / …」。
 * 终端默认名（「终端 / 终端 (2)」）与压缩包避开重名（「run / run (2)」）共用。
 */
export function numberedName(base: string, seq: number): string {
  return seq === 1 ? base : `${base} (${seq})`
}
