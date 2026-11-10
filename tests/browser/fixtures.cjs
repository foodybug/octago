// Extended budgets isolate item and milestone mechanics from the starting difficulty.
async function withStartingMoves(page,moves,plain=false){
  if(!Number.isSafeInteger(moves)||moves<=0)throw Error('Invalid fixture budget');
  await page.route('**/engine.js',async route=>{
    const response=await route.fetch(),body=await response.text();
    await route.fulfill({response,body:body+`\n{const create=globalThis.Octago.create;globalThis.Octago.create=(...args)=>{const s=create(...args);return {...s,remainingMoves:${moves},board:s.board${plain?'.map(({bonus,mystery,penalty,penaltyMode,...card})=>card)':''}};};}`});
  });
}
async function withStartingStage(page,stage){
  if(!Number.isSafeInteger(stage)||stage<1)throw Error('Invalid fixture stage');
  await page.route('**/engine.js',async route=>{
    const response=await route.fetch(),body=await response.text();
    await route.fulfill({response,body:body+`\n{const create=globalThis.Octago.create;globalThis.Octago.create=(...args)=>{const s=create(...args),board=s.board.map(({mystery,bonus,penalty,penaltyMode,...card})=>card);return globalThis.Octago.complete({...s,board,moves:${stage-1},status:'settling'});};}`});
  });
}
async function enterGame(page,seed='octago-001'){
  await page.locator('#title-start').click();await page.locator('#new-button').click();await page.locator('#seed-input').fill(seed);await page.locator('#start-button').click();
  await page.locator('#board > .card').evaluateAll(cards=>cards.forEach(card=>card.getAnimations().forEach(animation=>animation.finish())));
}
module.exports={withStartingMoves,withStartingStage,enterGame};
