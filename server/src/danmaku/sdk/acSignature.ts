/**
 * 抖音 __ac_signature 算法
 *
 * 移植自 DouyinLiveWebFetcher/ac_signature.py:get__ac_signature()
 *
 * 关键点：Python 是 arbitrary-precision int，整数操作不会自动截断。
 *       JS 的 `>>>` / `>>` / `&` 会把操作数 ToInt32 / ToUint32，超过 32 位的高位会丢。
 *       这里 b 是 46 位（"10000000110000" 14 位 + 32 位时间戳位），所以中间值用 BigInt，
 *       最终 enc_num_to_str 只要低 30 位（5 组 6 位），再切回 number。
 *
 * 三种 cal_* 哈希都用 `& 0xFFFFFFFF` 模拟 JS 的 `>>> 0`：
 *   - calOneStr   : k = (k ^ char) * 65599
 *   - calOneStr2 : 循环 32 次，k = k * 65599 + s[k % len]
 *   - calOneStr3 : k = k * 65599 + char（纯累乘）
 *
 * 字符集：
 *   0-25  → 'A'-'Z'
 *   26-51 → 'a'-'z'   (chr(71+enc) = 'a'+enc-26)
 *   52-61 → '0'-'9'   (chr(enc-4))
 *   62-63 → '+' '/'   (chr(enc-17))
 */
const SIGN_HEAD = '_02B4Z6wo00f01'
const ENC_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const MASK32 = 0xffffffff
const MASK30 = 0x3fffffff

function calOneStr(s: string, iv: number): number {
  let k = iv >>> 0
  for (let i = 0; i < s.length; i++) {
    k = (((k ^ s.charCodeAt(i)) & MASK32) * 65599) & MASK32
  }
  return k >>> 0
}

function calOneStr2(s: string, iv: number): number {
  let k = iv >>> 0
  const a = s.length
  for (let i = 0; i < 32; i++) {
    k = (((k * 65599) & MASK32) + s.charCodeAt(k % a)) & MASK32
  }
  return k >>> 0
}

function calOneStr3(s: string, iv: number): number {
  let k = iv >>> 0
  for (let i = 0; i < s.length; i++) {
    k = (((k * 65599) & MASK32) + s.charCodeAt(i)) & MASK32
  }
  return k >>> 0
}

function encNumToStr30(n: bigint): string {
  let s = ''
  for (let i = 24n; i >= 0n; i -= 6n) {
    const bits = Number((n >> i) & 0x3fn)
    s += ENC_ALPHABET[bits]
  }
  return s
}

/**
 * @param oneSite       站点域名（不要带协议头；Python 例子里传 `www.douyin.com/`）
 * @param oneNonce      __ac_nonce（21 字符串）
 * @param ua            User-Agent
 * @param timestamp     时间戳（秒），默认当前时间
 */
export function getAcSignature(
  oneSite: string,
  oneNonce: string,
  ua: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  const tsBig = BigInt(timestamp)
  const timeStampS = String(timestamp)

  // a
  const a = calOneStr(oneSite, calOneStr(timeStampS, 0)) % 65521

  // b = int("10000000110000" + ts_bin32, 2)   — 46 位
  const xorVal = tsBig ^ (BigInt(a) * 65521n)
  const bin32 = xorVal.toString(2).padStart(32, '0')
  const bBig = BigInt(parseInt('10000000110000' + bin32, 2)) // 46 位无符号整数
  const bS = bBig.toString()

  // c (bS 长度远小于 32，calOneStr 自动 32 位)
  const c = calOneStr(bS, 0)

  // d / e / f / g / h / i   — 全用 BigInt 走完整精度
  const d = encNumToStr30(bBig >> 2n)
  const eBig = bBig >> 32n // b / 2^32
  const f = encNumToStr30((bBig << 28n) | (eBig >> 4n))
  const gBig = 582085784n ^ bBig
  const h = encNumToStr30((eBig << 26n) | (gBig >> 6n))
  const i = ENC_ALPHABET[Number(gBig & 0x3fn)]

  // j / k / l / m   — j 是 32 位
  const j =
    (((calOneStr(ua, c) % 65521) << 16) | (calOneStr(oneNonce, c) % 65521)) &
    MASK32
  const k = encNumToStr30(BigInt(j) >> 2n)
  const l = encNumToStr30(
    (BigInt(j) << 28n) | ((524576n ^ bBig) >> 4n),
  )
  const m = encNumToStr30(BigInt(a))

  // n + checksum o
  const n = SIGN_HEAD + d + f + h + i + k + l + m
  const oHex = calOneStr3(n, 0).toString(16)
  const o = oHex.slice(-2).padStart(2, '0')

  return n + o
}
