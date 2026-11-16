// Results — adapted from video-shotcraft demos/transition/card-flip-reveal (CardFlipReveal.tsx).
// Kept: 4f wind-up to -10°, 16f flip to 194° (bezier .55,0,.3,1), spring settle to 180°, lift while
// flipping, |cos θ| face shading + edge light band 60–120°, number spring 1.08→1, label 4f later, before/after
// bars that grow after landing, mirror floor reflection, slow push-in. Changed: the three cards are
// FloorProof's measured results from scripts/reproduce.py, each flips when the narrator reaches it.
// 功能卡 3D 翻面揭示（card-flip-reveal）——Apple bento 翻转段。
// 手法不变：一排功能卡逐张错峰沿 Y 轴翻 180°（perspective + 双面 backface hidden），正面是功能界面，
// 背面是它带来的大号结论数字（语义成对）；翻转末端过冲再回落，侧棱最薄处有一道随角度走的受光。
//
// 第二轮重设计（设计决定）
// - look = graphite（近单色暗场，白为强调、香槟金点缀）。正面是暗色功能卡，背面是亮瓷白结论卡：
//   翻面 = 从暗到亮的反相，"所以呢？"的答案被打亮，三张翻完画面从一排暗卡变成一排白色数字海报。
// - 内容：video-shotcraft 的三项能力——Prompt（一句话写片）/ Recipes（镜头配方）/ Library（配方库搜索），
//   正面画成为镜头设计的大字 UI（≥ 28px），背面 158px 数字 3.2× / −41% / 0.2s + 34px 结论，上方一组「之前 / 用上之后」对照条在落定后收短。
// - 卡片竖版 480×620（bento 比例），三卡 1536px 宽占画宽 80%；左上 84px 标题 + 金色眉题；
//   卡片立在一面暗色镜面地板上——每张卡在地板里有一份同步翻转的倒影（遮罩渐隐），空间一下就成立了。
// - 翻转动作：4f 预备（反向后仰 −10°）→ 16f 加速翻到 194°（bezier 0.55,0,0.3,1）→ 物理弹簧落回 180°；
//   翻转中卡片离地抬起（scale +6%）、面随偏离主光的角度变暗（|cos θ| 着色），侧棱 60–120° 有一道
//   随角度从左扫到右的窄受光（物理光照，不是额外的扫光特效）。背面数字在落定时由 1.08 收到 1，标签晚 4f。
//
// 时间表（30fps，150f）
//   0–16    暗卡一排已在画面，眉题 + 标题逐行升起，相机全程 1 → 1.03 极缓推近
//   22–48   卡 0：22 预备 → 26–42 翻转 → 42–52 弹簧落定，数字收拢、标签升起
//   34–60   卡 1（错峰 12f）
//   46–72   卡 2
//   72–150  全部落定后 hold ~78f（R1），尾帧是三张白色结论卡的海报
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { EASE, FONT, bezier, mix, ramp } from '../demos/_fixtures/Polish';
import { LOOKS, Stage, TextReveal, alpha, springAt, type } from '../demos/_fixtures/Look';
import { FONTS } from '../theme';

export const RESULTS_DURATION = 398;

const L = LOOKS.graphite;
const GOLD = '#5ad1ff';
const CW = 480;
const CH = 620;
const GAP = 48;
const X0 = (1920 - (CW * 3 + GAP * 2)) / 2; // 192
const Y = 330;
// Each card flips when the narration reaches its number.
const FLIP_AT = [34, 178, 292];
const PRE = 4; // 预备帧
const FLIP = 16; // 翻转帧
const PEAK_DEG = 194;

const flipEase = bezier(0.55, 0, 0.3, 1);

// 卡 i 在帧 f 的翻转角：0 → −10（预备）→ 194（加速翻转）→ 180（弹簧落定）
const angleAt = (f: number, i: number) => {
  const s = FLIP_AT[i];
  if (f < s + PRE) return -10 * ramp(f, s, PRE, EASE.out);
  if (f < s + PRE + FLIP) return mix(-10, PEAK_DEG, ramp(f, s + PRE, FLIP, flipEase));
  return PEAK_DEG - (PEAK_DEG - 180) * springAt(f, s + PRE + FLIP, { damping: 15, stiffness: 190 });
};

const FEATURES = [
  { name: 'Graph checks', desc: '20 planted unsafe layouts, 10 safe ones.', value: '18/20', label: 'unsafe blocked · 0 false alarms', bars: [1, 0.9], unit: ['20', '18'], rows: ['Planted unsafe', 'Blocked'] },
  { name: 'Model alone', desc: 'First layout for 30 requests, no checks.', value: '5/30', label: 'broke a safety rule', bars: [1, 5 / 30], unit: ['30', '5'], rows: ['Requests', 'Broke a rule'] },
  { name: 'Model + graph', desc: 'Same 30 requests, checks in the loop.', value: '29/30', label: 'proven, and did what was asked', bars: [1, 29 / 30], unit: ['30', '29'], rows: ['Requests', 'Proven'] },
];

// ───────────── 正面 UI（暗色、大字） ─────────────
const FrontUI: React.FC<{ i: number; frame: number }> = ({ i }) => {
  const ink = L.ink, ink2 = L.ink2;
  const rows: [string, string][][] = [
    [['u04', 'table blocks A3’s work position'], ['u10', 'main aisle narrowed'], ['u13', 'drop box over its limit'], ['u18', 'line flows backward']],
    [['r01', 'Add 4 pressing machines to Line B'], ['r07', 'Add 2 more fabric racks'], ['r27', 'Add 3 flammable liquid pallets']],
    [['1', 'model proposes a layout'], ['2', 'Relate checks it, rolled back'], ['3', 'failures go back as feedback'], ['✓', 'only proven layouts shown']],
  ];
  return (
    <div>
      {rows[i].map(([k, t], n) => (
        <div key={n} style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: n ? 16 : 0 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 22, fontWeight: 600, color: n === rows[i].length - 1 && i === 2 ? GOLD : alpha(ink, 0.55), minWidth: 42 }}>{k}</div>
          <div style={{ fontSize: 27, color: n === 0 ? ink : ink2, fontWeight: 500, lineHeight: 1.25 }}>{t}</div>
        </div>
      ))}
    </div>
  );
};

// 受光着色：面偏离正面越多越暗；60–120° 区间一道随角度从左扫到右的窄受光（只在侧棱最薄附近）
const FaceLight: React.FC<{ angle: number; dark: boolean }> = ({ angle, dark }) => {
  const c = Math.abs(Math.cos((angle * Math.PI) / 180));
  const shade = (1 - c) * (dark ? 0.55 : 0.4);
  const band = Math.max(0, 1 - Math.abs(angle - 90) / 34);
  const pos = mix(-20, 120, Math.min(1, Math.max(0, (angle - 56) / 68)));
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: shade }} />
      {band > 0.01 && (
        <div style={{
          position: 'absolute', inset: 0, opacity: band * (dark ? 0.5 : 0.35),
          background: `linear-gradient(100deg, rgba(255,255,255,0) ${pos - 12}%, rgba(255,255,255,0.9) ${pos}%, rgba(255,255,255,0) ${pos + 12}%)`,
        }} />
      )}
    </>
  );
};

const FlipCard: React.FC<{ i: number; frame: number }> = ({ i, frame }) => {
  const angle = angleAt(frame, i);
  const f = FEATURES[i];
  const s = FLIP_AT[i];
  const lift = Math.max(0, Math.sin((Math.min(180, Math.max(0, angle)) * Math.PI) / 180));
  const land = s + PRE + FLIP;
  const num = springAt(frame, land - 2, { damping: 18, stiffness: 160 });
  const lab = ramp(frame, land + 2, 14, EASE.snappy);
  return (
    <div style={{ position: 'absolute', inset: 0, perspective: 1600 }}>
      <div style={{
        position: 'absolute', inset: 0, transformStyle: 'preserve-3d',
        transform: `translateZ(${(lift * 60).toFixed(2)}px) rotateY(${angle.toFixed(3)}deg)`,
      }}>
        {/* 正面：暗色功能卡 */}
        <div style={{
          position: 'absolute', inset: 0, backfaceVisibility: 'hidden', borderRadius: 34, overflow: 'hidden',
          background: `linear-gradient(180deg, #1d1e22 0%, ${L.surface} 48%, #111214 100%)`,
          boxShadow: `inset 0 0 0 1.5px ${alpha('#ffffff', 0.09)}, inset 0 2px 0 ${alpha('#ffffff', 0.08)}`,
          fontFamily: FONT.sans,
        }}>
          <div style={{ position: 'absolute', left: 40, top: 40, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 22, fontWeight: 600, color: L.ink3 }}>0{i + 1}</div>
            <div style={{ ...type(22, 700, { caps: true }), color: L.ink2, letterSpacing: '0.16em' }}>Test</div>
          </div>
          <div style={{ position: 'absolute', left: 40, right: 40, top: 112 }}>
            <FrontUI i={i} frame={frame} />
          </div>
          <div style={{ position: 'absolute', left: 40, right: 40, bottom: 40 }}>
            <div style={{ ...type(48, 750), color: L.ink }}>{f.name}</div>
            <div style={{ ...type(28, 450), color: L.ink2, marginTop: 10 }}>{f.desc}</div>
          </div>
          <FaceLight angle={angle} dark />
        </div>
        {/* 背面：瓷白结论卡 */}
        <div style={{
          position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', borderRadius: 34, overflow: 'hidden',
          background: 'linear-gradient(180deg, #fbfaf7 0%, #f1f0ec 100%)',
          boxShadow: `inset 0 0 0 1.5px rgba(0,0,0,0.06), inset 0 2px 0 rgba(255,255,255,0.9)`,
          fontFamily: FONT.sans, color: '#0d0d0f',
        }}>
          <div style={{ position: 'absolute', left: 40, top: 40, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: 6, background: i === 1 ? '#d92d2b' : '#0f9d58' }} />
            <div style={{ ...type(22, 700, { caps: true }), color: '#6b6a66', letterSpacing: '0.16em' }}>{f.name}</div>
          </div>
          {/* 对照条：之前 / 用上之后（落定后才长出来） */}
          <div style={{ position: 'absolute', left: 40, right: 40, top: 112 }}>
            {f.rows.map((t, k) => {
              const g = k === 0 ? 1 : ramp(frame, land + 4, 18, EASE.snappy);
              const w = k === 0 ? f.bars[0] : mix(f.bars[0], f.bars[1], g);
              return (
                <div key={t} style={{ marginTop: k ? 26 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline' }}>
                    <div style={{ ...type(22, 700, { caps: true }), color: k ? '#0d0d0f' : '#8a8984', letterSpacing: '0.14em' }}>{t}</div>
                    <div style={{ marginLeft: 'auto', fontFamily: FONT.mono, fontSize: 24, fontWeight: 600, color: k ? '#0d0d0f' : '#8a8984', opacity: k ? lab : 1 }}>{f.unit[k]}</div>
                  </div>
                  <div style={{ height: 16, borderRadius: 8, marginTop: 10, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                    <div style={{ width: `${(w * 100).toFixed(2)}%`, height: '100%', borderRadius: 8, background: k ? (i === 1 ? '#d92d2b' : '#0f9d58') : 'rgba(0,0,0,0.18)' }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ position: 'absolute', left: 36, right: 30, bottom: 138 }}>
            <div style={{
              ...type(124, 800), letterSpacing: '-0.05em', lineHeight: 0.9, color: i === 1 ? '#b42323' : '#0d0d0f', whiteSpace: 'nowrap',
              transform: `scale(${mix(1.08, 1, num).toFixed(4)})`, transformOrigin: 'left bottom',
            }}>{f.value}</div>
          </div>
          <div style={{
            position: 'absolute', left: 40, right: 40, bottom: 40, ...type(28, 550), color: '#3d3c39', lineHeight: 1.25,
            opacity: lab, transform: `translateY(${((1 - lab) * 14).toFixed(2)}px)`,
          }}>{f.label}</div>
          <FaceLight angle={180 - angle} dark={false} />
        </div>
      </div>
    </div>
  );
};

export const Results: React.FC = () => {
  const frame = useCurrentFrame();
  const push = 1 + 0.03 * ramp(frame, 0, 398, EASE.smooth);
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Stage look={L} keyLight={{ x: 0.5, y: -0.05 }} fill={{ x: 0.5, y: 1.1 }} horizon={0.88} intensity={0.9}>
        {/* 镜面地板：地平线以下略亮的反射面 */}
        <div style={{
          position: 'absolute', left: 0, right: 0, top: Y + CH, bottom: 0,
          background: `linear-gradient(180deg, ${alpha('#ffffff', 0.035)} 0%, ${alpha('#ffffff', 0)} 60%)`,
          borderTop: `1px solid ${alpha('#ffffff', 0.06)}`,
        }} />
      </Stage>
      <AbsoluteFill style={{ transform: `scale(${push.toFixed(4)})`, transformOrigin: '50% 60%' }}>
        {/* 标题 */}
        <div style={{ position: 'absolute', left: X0, top: 118, fontFamily: FONT.sans }}>
          <div style={{ ...type(26, 700, { caps: true }), color: GOLD, letterSpacing: '0.18em' }}>
            <TextReveal text="FloorProof · measured by scripts/reproduce.py" by="word" variant="blur" start={0} each={14} gap={2} />
          </div>
          <div style={{ ...type(84, 760), color: L.ink, marginTop: 18 }}>
            <TextReveal text="The graph catches what the model misses." by="word" variant="rise" start={2} each={18} gap={2.5} />
          </div>
        </div>
        {[0, 1, 2].map((i) => (
          <React.Fragment key={i}>
            {/* 倒影：同一张卡竖直镜像，遮罩渐隐 */}
            <div style={{
              position: 'absolute', left: X0 + i * (CW + GAP), top: Y + CH + 6, width: CW, height: CH,
              transform: 'scaleY(-1)', transformOrigin: 'center', opacity: 0.22,
              WebkitMaskImage: 'linear-gradient(0deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 26%)',
              maskImage: 'linear-gradient(0deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 26%)',
            }}>
              <FlipCard i={i} frame={frame} />
            </div>
            {/* 接地影 */}
            <div style={{
              position: 'absolute', left: X0 + i * (CW + GAP) + 30, width: CW - 60, top: Y + CH - 18, height: 36, borderRadius: '50%',
              background: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(0,0,0,0.7), rgba(0,0,0,0) 70%)',
              transform: `scaleX(${Math.max(0.12, Math.abs(Math.cos((angleAt(frame, i) * Math.PI) / 180))).toFixed(3)})`,
            }} />
            <div style={{ position: 'absolute', left: X0 + i * (CW + GAP), top: Y, width: CW, height: CH }}>
              <FlipCard i={i} frame={frame} />
            </div>
          </React.Fragment>
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
