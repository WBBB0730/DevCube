import { describe, expect, it } from 'vitest'
import { openSshPrivateKeyPublicBlob } from './ssh-identities'

// 测试专用的密钥（ssh-keygen -t ed25519 -N test-pass 生成），不对应任何服务器
const ENCRYPTED = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABAspjLY9v
osTpIMLvb8AQyZAAAAGAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAIPDGfy4Pxi/Znc/Y
+EA37dmMSTVH5PJ0ob4dCR2URaxeAAAAkG3J7GQOKVOQ0LKAPAazIN1mD5n4LcoWhU+R2Z
G4rHcykXMedLQ/bA2YVXS5M1a4xjiZplbR870VuSh/28yNgqrlNTACxQF/ZLtu9dRfi+Sn
DpyNxLfycqYRMIMwh+OJQatG/1IqhYKGK1SiF9I9QdvUhdej0/oMjrKkl0j+TmU5Cs46ae
nxxLeOr/KIfwcaYg==
-----END OPENSSH PRIVATE KEY-----
`
const PUBLIC = 'AAAAC3NzaC1lZDI1NTE5AAAAIPDGfy4Pxi/Znc/Y+EA37dmMSTVH5PJ0ob4dCR2URaxe'

describe('openSshPrivateKeyPublicBlob', () => {
  it('加了口令的 OpenSSH 私钥：从文件头读出公钥，与 .pub 一致', () => {
    expect(openSshPrivateKeyPublicBlob(ENCRYPTED)?.toString('base64')).toBe(PUBLIC)
  })

  it('不是 OpenSSH 新格式或内容残缺时为 null', () => {
    expect(
      openSshPrivateKeyPublicBlob(
        '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----'
      )
    ).toBeNull()
    expect(
      openSshPrivateKeyPublicBlob(
        '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\n-----END OPENSSH PRIVATE KEY-----'
      )
    ).toBeNull()
  })
})
