import { BUS_INTRO_ENABLED } from "./flags";
import { OPENING_SKIP_PATH } from "./timing";

/**
 * Runs inline in <head>, before first paint, so a cold start shows the opening from the very first frame and never flashes the
 * app first. It decides, sets html[data-opening="in"] and lets a tap take it away at once (the app may not be up yet to hear it);
 * the drawing is OpeningCover and the CSS, the tidying and the return-from-background case are OpeningHost.
 *
 * A cold start is a visit with nothing in this tab's sessionStorage yet: opening the installed app, a new tab, a link. A reload,
 * and moving between screens, keep it. Left out: the screens in OPENING_SKIP_PATH, a link to one thing (an event, a hotspot, a
 * room, a day), and a device that has never used Hoppaz (it gets the city title sequence instead: the same "first time" rule as
 * src/lib/opening/busIntro.ts, written out here because this runs before the app does: keep the two in step).
 * On a test host /?opening plays it whatever the rules say.
 */
export const BOOT_SCRIPT = `(function(){try{
var d=document.documentElement,p=location.pathname,q=location.search;
var t=/^(localhost|127\\.0\\.0\\.1|\\[::1\\]|10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.|[a-z0-9-]+\\.trycloudflare\\.com$)/i.test(location.hostname);
var f=t&&/[?&]opening(&|=|$)/.test(q);
if(!f){
var s=window.sessionStorage;
if(s.getItem("hz-open-s"))return;
s.setItem("hz-open-s","1");
if(${OPENING_SKIP_PATH.toString()}.test(p))return;
if(/[?&](e|hotspot|date)=/.test(q)||/^\\/(room|event)\\//.test(p))return;
${
  BUS_INTRO_ENABLED
    ? `var l=window.localStorage,u=!!(l.getItem("hz-bus-intro-v1")||l.getItem("hoppaz.locationAsk")),r=l.getItem("hz-first-v2");
if(r&&r!=="location")u=true;
if(!u){try{var o=JSON.parse(l.getItem("hoppaz.v1")||"null"),n=o&&o.state;if(n&&(n.fix||n.look||n.seenTitle||n.seenIntro))u=true}catch(e){}}
if(!u)return;`
    : ""
}
}
window.__hzOpenT=performance.now();
d.setAttribute("data-opening","in");
window.addEventListener("pointerdown",function(e){if(d.getAttribute("data-opening")==="in"){e.preventDefault();e.stopPropagation();d.setAttribute("data-opening","out")}},true);
}catch(e){}})();`;
