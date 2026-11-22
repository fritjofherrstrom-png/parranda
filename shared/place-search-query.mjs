// Two East Asian characters can name a complete city. Count code points so a
// single supplementary Han character cannot bypass the minimum via UTF-16.
export function isPlaceSearchQueryEligible(value) {
 if(typeof value!=='string')return false;
 const query=value.trim();
 if(query.length>200)return false;
 const length=Array.from(query).length;
 return length>=3||(length===2&&/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(query));
}
