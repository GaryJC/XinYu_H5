export function VehicleNameplateIllustration() {
 return <svg viewBox="0 0 400 164" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect width="400" height="164" fill="#e9eceb"/>
  <rect x="56" y="12" width="288" height="112" rx="7" fill="#f9faf9" stroke="#85938c" strokeWidth="2"/>
  <circle cx="65" cy="21" r="2" fill="#85938c"/><circle cx="335" cy="21" r="2" fill="#85938c"/>
  <text x="200" y="32" textAnchor="middle" fill="#48554f" fontSize="13" fontWeight="700">机动车制造铭牌 · 示例</text>
  <path d="M70 40H330" stroke="#b6c0bb"/>
  <g fill="#596960" fontSize="11">
   <text x="74" y="57">车辆型号</text><text x="178" y="57">XXXXXXXX</text>
   <text x="74" y="76">发动机型号</text><text x="178" y="76">XXXXXX</text>
   <text x="74" y="95">VIN / 车架号</text><text x="178" y="95" fontFamily="monospace">XXXXXXXXXXXXXXXXX</text>
   <text x="74" y="114">制造年月</text><text x="178" y="114">20XX 年 XX 月</text>
  </g>
  <path d="M43 34V8H69 M331 8H357V34 M43 101V128H69 M331 128H357V101" fill="none" stroke="#749286" strokeWidth="2.5" strokeLinecap="round"/>
 </svg>;
}
