import "./opening.css";

/**
 * The Hoppaz opening: the wordmark bounces in over a night skyline of Lagos (the National Theatre, Eko Atlantic, the Lekki-Ikoyi
 * link bridge) with LAGOS under it, and an okada rides across the road. About 1.65 s, pure inline SVG and CSS, no script of its
 * own. It is in the page's HTML but not drawn: html[data-opening] (set by BOOT_SCRIPT before first paint on a cold start, and by
 * OpeningHost when the app comes back after a while) draws it. See src/lib/opening/boot.ts and docs/OPENING.md.
 * Always the night set, whatever the Lagos clock says, like the title sequence.
 */
export default function OpeningCover() {
  return (
    <div className="hz-open" aria-hidden="true" data-opening-cover="">
          {/* sky: a moon and a few stars */}
          <svg className="hz-open-sky" viewBox="0 0 390 844" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
            <g fill="#F5EBDD">
              <circle cx="318" cy="132" r="26" opacity=".9"/>
              <circle cx="42" cy="86" r="1.6" opacity=".5"/><circle cx="96" cy="150" r="1.2" opacity=".4"/><circle cx="150" cy="64" r="1.8" opacity=".55"/>
              <circle cx="228" cy="104" r="1.3" opacity=".4"/><circle cx="268" cy="58" r="1.6" opacity=".5"/><circle cx="352" cy="228" r="1.2" opacity=".35"/>
              <circle cx="24" cy="236" r="1.4" opacity=".4"/><circle cx="196" cy="196" r="1.1" opacity=".3"/><circle cx="120" cy="250" r="1.2" opacity=".35"/>
            </g>
          </svg>
          <div className="hz-open-glow"></div>
    
          {/* the skyline: Lagos, tile 390 x 300, ground at y = 300 */}
          <div className="hz-open-city"><div className="hz-open-rise" style={{ width: "100%", height: "100%" }}>
            <svg viewBox="0 0 390 300" aria-hidden="true">
              {/* far layer */}
              <g fill="#17110F">
                <rect x="0" y="190" width="34" height="110"/><rect x="40" y="160" width="28" height="140"/><rect x="74" y="200" width="40" height="100"/>
                <rect x="120" y="150" width="30" height="150"/><rect x="156" y="176" width="36" height="124"/><rect x="198" y="140" width="26" height="160"/>
                <rect x="230" y="188" width="38" height="112"/><rect x="274" y="164" width="30" height="136"/><rect x="310" y="196" width="36" height="104"/><rect x="352" y="170" width="38" height="130"/>
              </g>
              {/* the National Theatre */}
              <g>
                <path d="M6 300 V254 H98 V300 Z" fill="#231915"/>
                <path d="M0 254 L16 206 H88 L104 254 Z" fill="#2E211C"/>
                <path d="M18 250 L24 212 M34 250 L38 212 M50 250 L52 212 M66 250 L66 212 M82 250 L80 212" stroke="#F5EBDD" strokeWidth="2.4" opacity=".4"/>
                <rect x="0" y="250" width="104" height="5" fill="#FF4D00"/>
              </g>
              {/* two towers */}
              <g fill="#231915">
                <rect x="112" y="150" width="34" height="150"/><rect x="152" y="104" width="30" height="196"/>
              </g>
              <g fill="#F5EBDD">
                <rect x="119" y="162" width="6" height="8" opacity=".7"/><rect x="131" y="162" width="6" height="8" opacity=".5"/>
                <rect x="119" y="182" width="6" height="8" opacity=".5"/><rect x="131" y="182" width="6" height="8" opacity=".7"/>
                <rect x="119" y="202" width="6" height="8" opacity=".7"/><rect x="131" y="202" width="6" height="8"/>
                <rect x="119" y="222" width="6" height="8" opacity=".5"/><rect x="131" y="222" width="6" height="8" opacity=".7"/>
                <rect x="119" y="242" width="6" height="8" opacity=".7"/><rect x="131" y="242" width="6" height="8" opacity=".5"/>
                <rect x="158" y="118" width="6" height="8" opacity=".7"/><rect x="170" y="118" width="6" height="8" opacity=".5"/>
                <rect x="158" y="138" width="6" height="8" opacity=".5"/><rect x="170" y="138" width="6" height="8" opacity=".7"/>
                <rect x="158" y="158" width="6" height="8" opacity=".7"/><rect x="170" y="158" width="6" height="8"/>
                <rect x="158" y="178" width="6" height="8"/><rect x="170" y="178" width="6" height="8" opacity=".5"/>
                <rect x="158" y="198" width="6" height="8" opacity=".5"/><rect x="170" y="198" width="6" height="8" opacity=".7"/>
                <rect x="158" y="218" width="6" height="8" opacity=".7"/><rect x="170" y="218" width="6" height="8" opacity=".5"/>
                <rect x="158" y="238" width="6" height="8" opacity=".5"/><rect x="170" y="238" width="6" height="8" opacity=".7"/>
              </g>
              <rect x="166" y="92" width="2" height="12" fill="#F5EBDD" opacity=".6"/>
              <circle className="hz-open-blink" cx="167" cy="90" r="3" fill="#FF4D00"/>
              {/* Eko Atlantic glass */}
              <g fill="#231915">
                <rect x="190" y="130" width="26" height="170"/><rect x="220" y="86" width="32" height="214"/><rect x="256" y="144" width="26" height="156"/>
              </g>
              <g stroke="#F5EBDD" strokeWidth="2" opacity=".2">
                <path d="M196 140 V292 M203 140 V292 M210 140 V292 M227 96 V292 M235 96 V292 M243 96 V292 M262 154 V292 M269 154 V292 M276 154 V292"/>
              </g>
              <rect x="190" y="130" width="26" height="5" fill="#FF4D00"/><rect x="220" y="86" width="32" height="5" fill="#FF4D00"/><rect x="256" y="144" width="26" height="5" fill="#FF4D00"/>
              {/* Lekki-Ikoyi link bridge: deck, pylon, cables */}
              <rect x="282" y="238" width="108" height="9" fill="#231915"/><rect x="282" y="238" width="108" height="3" fill="#FF4D00"/>
              <rect x="332" y="246" width="8" height="54" fill="#2E211C"/>
              <path d="M328 238 L333 70 H339 L344 238 Z" fill="#F5EBDD" opacity=".92"/>
              <g stroke="#F5EBDD" strokeWidth="1.6" opacity=".55" fill="none">
                <path d="M336 80 L290 238 M336 96 L304 238 M336 112 L318 238 M336 80 L384 238 M336 96 L370 238 M336 112 L356 238"/>
              </g>
              <circle className="hz-open-blink" cx="336" cy="66" r="3" fill="#FF4D00"/>
            </svg>
          </div></div>
    
          <div className="hz-open-road"></div>
    
          {/* the wordmark and the line under it */}
          <div className="hz-open-mark">
            {/* eslint-disable-next-line @next/next/no-img-element -- the brand file, fixed size, no layout shift */}
            <img src="/brand/wordmark-cream.png" width={300} height={94} alt="" draggable={false} />
            <p>LAGOS</p>
          </div>
    
          {/* the okada */}
          <div className="hz-open-okada">
            <svg viewBox="0 0 132 84" aria-hidden="true">
              <g className="hz-open-bob">
                {/* wheels */}
                <g>
                  <circle cx="26" cy="66" r="15" fill="#0E0B0A" stroke="#F5EBDD" strokeWidth="3.5"/>
                  <g className="hz-open-spin"><path d="M26 54 V78 M14 66 H38 M17.5 57.5 L34.5 74.5 M34.5 57.5 L17.5 74.5" stroke="#F5EBDD" strokeWidth="1.4" opacity=".5"/></g>
                  <circle cx="26" cy="66" r="3.2" fill="#FF4D00"/>
                  <circle cx="104" cy="66" r="15" fill="#0E0B0A" stroke="#F5EBDD" strokeWidth="3.5"/>
                  <g className="hz-open-spin"><path d="M104 54 V78 M92 66 H116 M95.5 57.5 L112.5 74.5 M112.5 57.5 L95.5 74.5" stroke="#F5EBDD" strokeWidth="1.4" opacity=".5"/></g>
                  <circle cx="104" cy="66" r="3.2" fill="#FF4D00"/>
                </g>
                {/* bike */}
                <path d="M26 66 L58 60" stroke="#FF4D00" strokeWidth="5" strokeLinecap="round"/>
                <rect x="44" y="48" width="22" height="16" rx="4" fill="#231915" stroke="#B83600" strokeWidth="1.5"/>
                <path d="M50 44 Q62 38 80 42 L84 50 H50 Z" fill="#FF4D00"/>
                <path d="M82 40 L104 66" stroke="#F5EBDD" strokeWidth="4" strokeLinecap="round"/>
                <path d="M80 38 L92 35" stroke="#F5EBDD" strokeWidth="3.2" strokeLinecap="round"/>
                <path d="M89 50 Q104 44 112 62" stroke="#FF4D00" strokeWidth="3" fill="none" strokeLinecap="round"/>
                <rect x="16" y="43" width="42" height="6" rx="3" fill="#B83600"/>
                <path d="M16 46 L8 54" stroke="#FF4D00" strokeWidth="3" strokeLinecap="round"/>
                <circle cx="96" cy="42" r="4.2" fill="#F5EBDD"/>
                {/* rider */}
                <path d="M62 44 L66 56 L64 64" stroke="#9C9087" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                <path d="M62 42 L72 18" stroke="#F5EBDD" strokeWidth="10" strokeLinecap="round"/>
                <path d="M72 22 L88 36" stroke="#F5EBDD" strokeWidth="4" strokeLinecap="round"/>
                <circle cx="76" cy="9" r="7" fill="#F5EBDD"/><path d="M69.5 8 H82.5" stroke="#FF4D00" strokeWidth="3"/>
                {/* passenger */}
                <path d="M32 44 L42 56 L38 64" stroke="#9C9087" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                <path d="M32 44 L36 16" stroke="#B83600" strokeWidth="10" strokeLinecap="round"/>
                <path d="M40 22 L56 26" stroke="#B83600" strokeWidth="4" strokeLinecap="round"/>
                <circle cx="37" cy="8" r="6.4" fill="#E9D3B6"/>
              </g>
            </svg>
          </div>
        </div>
  );
}
