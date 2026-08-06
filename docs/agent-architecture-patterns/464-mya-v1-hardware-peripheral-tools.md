# Hướng QV: Hardware Peripheral Tools — tool GPIO/I2C/SPI/USB qua trait Peripheral điều khiển thế giới thật

> **Nguồn gốc:** mya-v1 (natives/agent design); "hardware peripheral trait"; "GPIO/I2C/SPI/USB tools"; "agent controls real-world hardware"; "Peripheral trait abstraction"; "deterministic device interface"
> **Coupling:** 🟡 — thêm Peripheral trait + concrete device tools (Rust native, platform parity) vào tool registry
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (chưa có Peripheral trait — cần Rust native qua napi-rs)
> **Effort:** 5-6 tuần

## Nguồn gốc

**mya-v1** thiết kế agent điều khiển **thế giới thật** qua **hardware peripheral tools**: agent không chỉ sửa code — nó **đọc sensor GPIO**, **điều khiển relay**, **giao tiếp I2C/SPI chip**, **stream USB device**. Mọi peripheral qua **trait `Peripheral`** thống nhất (`read` / `write` / `configure` / `close`), concrete impl cho từng bus (Linux sysfs `/sys/class/gpio`, `/dev/i2c-*`, `/dev/spidev*`, `libusb`). Nguyên tắc: **determinism + platform parity** (Rust gate — như §18: hot inner loop, determinism, platform parity) — hardware I/O không thể JS (timing-sensitive, syscall trực tiếp). Trait `Peripheral` cho phép agent nói chung (`peripheral.read(addr)`) rồi dispatch đúng bus. Khác **038 sandbox-ban** — QV là **real hardware**; khác pure software tool — QV **tương tác vật lý**.

## Mô tả

mya hardware peripheral tools: (1) **Trait Peripheral** (Rust): `trait Peripheral { fn read(&self, addr) -> NativeResult; fn write(&mut self, addr, val) -> NativeResult; fn configure(&mut self, cfg) -> NativeResult; }`. (2) **Concrete bus**: `Gpio` (sysfs/mem-mapped), `I2c` (`/dev/i2c`), `Spi` (`/dev/spidev`), `Usb` (libusb). (3) **Native tools** (napi-rs): `gpio_read(pin)`, `gpio_write(pin, val)`, `i2c_xfer(addr, data)`, `spi_transfer(data)`, `usb_read(endpoint)`. (4) **Agent dispatch**: agent gọi tool → Peripheral trait → bus → device. (5) **Safety**: pin/addr validation, permission check (`/dev` access), `NativeResult<T>` (no `process::exit`). mya có `packages/natives` (napi-rs Rust) — QV thêm **Peripheral trait** + **bus impls** + **native tool wrappers**.

## Kiến trúc

```
  AGENT: "đọc nhiệt độ từ sensor I2C addr 0x48"
        │
        ▼
  ┌─── NATIVE TOOLS (napi-rs, JS-visible) ──────────────┐
  │  i2c_xfer(addr=0x48, data=[0x00])  → NativeResult    │
  │  gpio_read(pin=17)                 → NativeResult    │
  │  spi_transfer(data=[0xFF])         → NativeResult    │
  └───────────────────────┬─────────────────────────────┘
                          │ (dispatch via trait)
                          ▼
  ┌─── trait Peripheral (Rust, §18 gate) ────────────────┐
  │  trait Peripheral {                                   │
  │    fn read(&self, addr)    -> NativeResult<Vec<u8>>   │
  │    fn write(&mut, addr, v) -> NativeResult<()>        │
  │    fn configure(&mut, cfg) -> NativeResult<()>        │
  │  }                                                     │
  └───────────┬───────────────┬───────────────┬──────────┘
              ▼               ▼               ▼
  ┌─── Gpio ──────┐  ┌─── I2c ──────┐  ┌─── Spi / Usb ─┐
  │ /sys/class/gpio│  │ /dev/i2c-1   │  │ /dev/spidev0  │
  │ pin 17: read   │  │ addr 0x48:   │  │ libusb:       │
  │ → 0/1 (button) │  │ → 0x1A (24°C)│  │ stream bytes  │
  └────────────────┘  └──────────────┘  └───────────────┘
              │
              ▼
  REAL WORLD: button press, temperature, motor, LED, sensor...
```

## mya ĐÃ CÓ (1 phần)

```rust
// ✅ packages/natives (napi-rs) — Rust→JS bridge (nền — QV = native peripheral)
// ✅ §18 NativeResult<T> — no process::exit (nền — QV dùng)
// ✅ 038 sandbox-ban — real filesystem (nền — QV real /dev)

// ❌ THIẾU: trait Peripheral (read/write/configure, NativeResult<T>)
// ❌ THIẾU: Gpio impl (sysfs /sys/class/gpio hoặc mem-mapped)
// ❌ THIẾU: I2c impl (/dev/i2c-*, ioctl I2C_SLAVE)
// ❌ THIẾU: Spi impl (/dev/spidev*, full-duplex transfer)
// ❌ THIẾU: Usb impl (libusb / nusb)
// ❌ THIẾU: native tool wrappers (gpio_read/write, i2c_xfer, spi_transfer, usb_read)
```

## Implementation

```rust
// crates/natives/src/peripheral.rs (MỚI, Rust — §18 gate)
use crate::native_result::{NativeResult, ok, err};

pub trait Peripheral {
    fn read(&self, addr: u32, len: usize) -> NativeResult<Vec<u8>>;
    fn write(&mut self, addr: u32, data: &[u8]) -> NativeResult<()>;
    fn configure(&mut self, cfg: &PeripheralConfig) -> NativeResult<()>;
}

pub struct Gpio { /* /sys/class/gpio or mem-mapped */ }
impl Peripheral for Gpio {
    fn read(&self, pin: u32, _len: usize) -> NativeResult<Vec<u8>> {
        let val = std::fs::read(format!("/sys/class/gpio/gpio{pin}/value"))
            .map_err(|e| err(format!("gpio read: {e}")))?;
        ok(vec![val[0] - b'0'])
    }
    fn write(&mut self, pin: u32, data: &[u8]) -> NativeResult<()> {
        std::fs::write(format!("/sys/class/gpio/gpio{pin}/value"), data.to_vec())
            .map_err(|e| err(format!("gpio write: {e}")))?;
        ok(())
    }
    fn configure(&mut self, _cfg: &PeripheralConfig) -> NativeResult<()> { ok(()) }
}

// napi-rs tool wrapper (JS-visible)
#[napi]
pub fn gpio_read(pin: u32) -> Result<u8> {  // → agent tool
    let g = Gpio { };
    match g.read(pin, 1) { Ok(v) => Ok(v[0]), Err(e) => Err(Error::from_reason(e)) }
}

#[napi]
pub fn i2c_xfer(bus: u32, addr: u16, data: Buffer) -> Result<Buffer> { /* ... */ }
```

```typescript
// packages/tools/src/peripheral-tools.ts (MỚI, JS agent-visible)
// ✅ tool.meta.name + tool.run() → ToolResult { ok, output }
const gpioRead = defineTool({
  meta: { name: 'gpio_read', description: 'Read GPIO pin value (0/1)' },
  async run({ pin }: { pin: number }) {
    const val = await natives.gpioRead(pin);  // napi-rs
    return { ok: true, output: String(val) };
  },
});
// registry: gpio_read, gpio_write, i2c_xfer, spi_transfer, usb_read
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent điều khiển thế giới thật (sensor, relay, motor) | ❌ Phần cứng phụ thuộc (cần /dev, quyền root/group) |
| ✅ Trait Peripheral (thống nhất, thêm bus dễ) | ❌ Timing-sensitive (cần Rust, không JS) |
| ✅ Deterministic (Rust, NativeResult, không exit) | ❌ Platform parity (Linux only cho sysfs; khác cho Win/Mac) |
| ✅ §18 gate hợp lệ (hot loop, determinism, parity) | ❌ Safety risk (short-circuit nếu write sai pin) |

## Khác các hướng gần

| | 038 Sandbox-Ban | Computer-Use (GUI) | QV: Hardware-Peripheral |
|---|---|---|---|
| Cái gì | Real filesystem | Màn hình/chuột | **GPIO/I2C/SPI/USB device** |
| Lớp | FS syscall | GUI automation | **Peripheral trait (Rust)** |
| Vật lý | File | Pixel | **Electrical signal** |

## Khi nào chọn

- Agent điều khiển phần cứng (IoT, robotics, embedded debug)
- Cần determinism + platform parity (§18 Rust gate)
- Bus đa dạng (GPIO/I2C/SPI/USB) cần trait thống nhất
- Nối packages/natives (napi-rs) + §18 NativeResult<T> (no exit); guard permission (/dev group), pin/addr validation (anti short-circuit), và platform guard (sysfs = Linux only); trait Peripheral là chìa — thêm bus = thêm 1 impl
