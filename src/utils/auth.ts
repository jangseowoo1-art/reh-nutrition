// JWT 유틸리티 (Web Crypto API 사용 - Cloudflare Workers 호환)
// btoa()는 Latin1 문자만 지원하므로 TextEncoder 기반 base64url 사용

function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function strToBase64Url(str: string): string {
  const encoder = new TextEncoder()
  return uint8ToBase64Url(encoder.encode(str))
}

function base64UrlToStr(b64: string): string {
  const pad = b64.length % 4
  const padded = b64 + (pad ? '===='.slice(pad) : '')
  const normalized = padded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function createToken(payload: Record<string, any>, secret: string): Promise<string> {
  const header = strToBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = strToBase64Url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 86400 * 7 }))
  const signature = await sign(`${header}.${body}`, secret)
  return `${header}.${body}.${signature}`
}

export async function verifyToken(token: string, secret: string): Promise<Record<string, any> | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [header, body, signature] = parts
    const expectedSig = await sign(`${header}.${body}`, secret)
    if (signature !== expectedSig) return null
    const payload = JSON.parse(base64UrlToStr(body))
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

async function sign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return uint8ToBase64Url(new Uint8Array(signature))
}
