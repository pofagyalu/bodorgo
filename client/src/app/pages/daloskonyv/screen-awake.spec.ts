import { ScreenAwake } from './screen-awake';

describe('ScreenAwake', () => {
  let request: ReturnType<typeof vi.fn>;
  let release: ReturnType<typeof vi.fn>;
  // Lets the lock's promise settle.
  const settle = () => vi.advanceTimersByTimeAsync(0);
  const MINUTE = 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    release = vi.fn(() => Promise.resolve());
    request = vi.fn(() =>
      Promise.resolve({ release, addEventListener: vi.fn() } as unknown as WakeLockSentinel),
    );
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  });

  it('keeps the screen on from the start, and lets it go 10 minutes untouched', async () => {
    const awake = new ScreenAwake();
    awake.start();
    await settle();
    expect(request).toHaveBeenCalledWith('screen');
    await vi.advanceTimersByTimeAsync(9 * MINUTE);
    expect(release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(release).toHaveBeenCalledTimes(1);
    awake.stop();
  });

  it('counts the 10 minutes again from every touch, and takes the screen back after', async () => {
    const awake = new ScreenAwake();
    awake.start();
    await settle();
    await vi.advanceTimersByTimeAsync(8 * MINUTE);
    document.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(8 * MINUTE);
    expect(release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(release).toHaveBeenCalledTimes(1);

    // Dark again (or about to be): a touch asks for it anew.
    document.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    awake.stop();
  });

  it('holds on while the page is busy, however long untouched', async () => {
    let scrolling = true;
    const awake = new ScreenAwake(() => scrolling);
    awake.start();
    await settle();
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(release).not.toHaveBeenCalled();
    scrolling = false;
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(release).toHaveBeenCalledTimes(1);
    awake.stop();
  });

  it('lets go when stopped, and touches no longer count', async () => {
    const awake = new ScreenAwake();
    awake.start();
    await settle();
    awake.stop();
    expect(release).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does nothing where the browser has no wake lock', async () => {
    delete (navigator as { wakeLock?: unknown }).wakeLock;
    const awake = new ScreenAwake();
    expect(() => awake.start()).not.toThrow();
    await settle();
    awake.stop();
  });
});
