(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.OctagoPlatform=api;
})(globalThis,function(root){
  'use strict';
  function newId(){
    if(typeof root.crypto?.randomUUID==='function')return root.crypto.randomUUID();
    const bytes=root.crypto.getRandomValues(new Uint8Array(16));
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  }
  function apiUrl(path,base=root.OCTAGO_CONFIG?.apiBaseUrl||''){
    if(!base)return path;
    const url=new URL(base);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('랭킹 서버 주소를 확인해 주세요.');
    return url.href.replace(/\/+$/,'')+path;
  }
  return {newId,apiUrl};
});
