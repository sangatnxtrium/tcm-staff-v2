export function makeCommandCenter({d,LT}){
function tile(label,tone,detail){const cls="good"===tone?"low":"warn"===tone?"med":"bad"===tone?"high":"";const pill="off"===tone?'<span style="color:var(--muted);">—</span>':`<span class="tag ${cls}">${"good"===tone?"On track":"warn"===tone?"Watch":"Attention"}</span>`;return`<div class="kpi"><div class="label">${label}</div><div class="value">${pill}</div><div class="delta" style="color:var(--muted);font-weight:400;">${detail}</div></div>`}
function li(item){return item.view?`<li style="margin-bottom:6px;cursor:pointer;" data-goto-view="${item.view}">${item.text} <span style="color:var(--purple);font-weight:600;">&rarr;</span></li>`:`<li style="margin-bottom:6px;">${item.text}</li>`}
function renderList(items){return items.length?`<ul style="margin:0;padding-left:18px;">${items.map(li).join("")}</ul>`:'<p style="color:var(--muted);margin:0;">Nothing flagged right now.</p>'}
function syncInfo(sync){if(!sync)return{ageHrs:null,tone:"off",detail:"No sync data yet",stale:false,staffError:false};const ageHrs=Math.round((Date.now()-new Date(sync.asOf).getTime())/3600000);const stale=ageHrs>36;const tone=sync.staffError?"warn":stale?"warn":"good";const detail=(sync.staffError?"Staff sales attribution failing":`Last synced ${ageHrs<24?ageHrs+"h ago":Math.round(ageHrs/24)+"d ago"}`)+(stale&&!sync.staffError?" — sync overdue":"");return{ageHrs,tone,detail,stale,staffError:!!sync.staffError}}

function CC(e,role){
if("Logistics Manager"===role)return CCLog(e);
if("Inventory Manager"===role)return CCInv(e);
if("Customer Experience Manager"===role||"Customer Experience Specialist"===role)return CCCX(e);
if("Growth & Marketing"===role)return CCMkt(e);
const sum=e.shopify_summary||{},last30=sum.last30Days||{sales:0,orders:0,grossSales:0},prev30=sum.prev30Days||{sales:0,orders:0,grossSales:0};
const salesChangePct=prev30.sales?Math.round((last30.sales-prev30.sales)/prev30.sales*100):0;
const si=syncInfo(e.sync_status||null);
const onlineOrders=e.online_orders||[],agingOrders=onlineOrders.filter(o=>(Date.now()-new Date(o.createdAt).getTime())/3600000>48);
const lots=e.merchandise_lots||[],activeLots=lots.filter(l=>l.stage!=="Listed"),AGING_DAYS=14;
const agingLots=activeLots.filter(l=>{const hist=l.stageHistory||[],last=hist[hist.length-1];if(!last)return!1;return(Date.now()-new Date(last.enteredAt).getTime())/86400000>AGING_DAYS});
const agingLotsValue=agingLots.reduce((s,l)=>s+(Number(l.purchasePrice)||0),0);
const rewards=e.reward_customers||[],goldCount=rewards.filter(c=>"Gold"===c.tier).length,silverCount=rewards.filter(c=>"Silver"===c.tier).length;
const staffSales=(e.staff_sales||[]).slice().sort((a,b)=>b.sales-a.sales),topPerformer=staffSales[0]||null;
const categories=e.sales_by_category||[],uncategorized=categories.find(c=>/uncat/i.test(c.category)),totalCatSales=categories.reduce((s,c)=>s+c.sales,0),uncategorizedPct=uncategorized&&totalCatSales?Math.round(uncategorized.sales/totalCatSales*100):0;
const listedLots=lots.filter(l=>"Listed"===l.stage),realizedProfit=listedLots.reduce((s,l)=>s+(Number(l.profit100d)||0),0),pipelineEstValue=activeLots.reduce((s,l)=>s+(Number(l.estValue)||Number(l.purchasePrice)||0),0);
const cal=e.marketing_calendar||{},now=Date.now(),next7=[...Array(7)].map((_,i)=>new Date(now+i*86400000).toISOString().slice(0,10)),coveredDays=next7.filter(dt=>(cal[dt]||[]).length>0).length,gapDays=next7.filter(dt=>!(cal[dt]||[]).length);
const syncTile=tile("Shopify Sync",si.tone,si.detail);
const salesTile=tile("Sales (30d)",salesChangePct>=0?"good":salesChangePct>-20?"warn":"bad",`${salesChangePct>=0?"▲":"▼"} ${Math.abs(salesChangePct)}% vs prior 30 days`);
const fulfillmentTile=tile("Fulfillment",0===agingOrders.length?"good":agingOrders.length<5?"warn":"bad",`${agingOrders.length} order${1===agingOrders.length?"":"s"} unfulfilled 48h+ (of ${onlineOrders.length} pending)`);
const pipelineTile=tile("Buying/Inventory Pipeline",0===agingLots.length?"good":agingLots.length<5?"warn":"bad",`${agingLots.length} lot${1===agingLots.length?"":"s"} stuck 14+ days ($${agingLotsValue.toLocaleString()})`);
const customersTile=tile("Rewards",'off',`${goldCount} Gold, ${silverCount} Silver`);
const marginTile=tile("Pipeline Profit",listedLots.length?(realizedProfit>=0?"good":"bad"):"off",`$${realizedProfit.toLocaleString()} realized (Listed, ~100d) + $${pipelineEstValue.toLocaleString()} est. value in pipeline`);
const marketingTile=tile("Content Coverage (7d)",0===gapDays.length?"good":gapDays.length<=3?"warn":"bad",`${coveredDays}/7 days have scheduled content`);
const attentionItems=[];
if(si.staffError)attentionItems.push({text:"Shopify sync: staff sales attribution is failing — check the Automations page.",view:"automations"});
if(si.stale)attentionItems.push({text:`Shopify data hasn't synced in over 36 hours (last synced ${si.ageHrs}h ago) — run Sync Now on the Automations page.`,view:"automations"});
if(agingLots.length)attentionItems.push({text:`${agingLots.length} pipeline lot${1===agingLots.length?"":"s"} worth $${agingLotsValue.toLocaleString()} have sat in the same stage 14+ days — see Merchandise Pipeline.`,view:"merchandise"});
if(agingOrders.length)attentionItems.push({text:`${agingOrders.length} paid order${1===agingOrders.length?"":"s"} still unfulfilled after 48 hours — see Online Fulfillment.`,view:"fulfillment"});
if(gapDays.length)attentionItems.push({text:`${gapDays.length} of the next 7 days have no content scheduled — see Calendar.`,view:"calendar"});
if(uncategorized&&uncategorizedPct>=25)attentionItems.push({text:`${uncategorizedPct}% of category sales ($${uncategorized.sales.toLocaleString()}) are still "Uncategorized" — worth a bulk-tagging pass.`});
const oppItems=[];
if(topPerformer)oppItems.push({text:`${d(topPerformer.name)} is the top performer this period — $${topPerformer.sales.toLocaleString()} across ${topPerformer.transactions} sales.`,view:"staffsales"});
if(categories[0])oppItems.push({text:`${d(categories[0].category)} is the top-selling category ($${categories[0].sales.toLocaleString()}).`,view:"dashboard"});
if(goldCount)oppItems.push({text:`${goldCount} customer${1===goldCount?"":"s"} currently qualify for Gold tier — worth a VIP outreach pass.`,view:"rewards"});
return`
<p style="font-size:12.5px;color:var(--muted);margin:-4px 0 14px;">A read-only snapshot built from data already flowing into TCM Staff. Data refreshes via <b>Sync Now</b> on the Automations page — there's no separate sync control here.</p>
<div class="panel" style="margin-bottom:16px;"><h3 style="margin-top:0;">Business Health</h3><div class="kpi-grid">${syncTile}${salesTile}${fulfillmentTile}${pipelineTile}${customersTile}${marginTile}${marketingTile}</div></div>
<div class="panel" style="margin-bottom:16px;"><h3 style="margin-top:0;">Needs Attention</h3>${renderList(attentionItems)}</div>
<div class="panel"><h3 style="margin-top:0;">Opportunities</h3>${renderList(oppItems)}</div>`
}

function CCLog(e){
const onlineOrders=e.online_orders||[],refundedOrders=e.refunded_orders||[];
const si=syncInfo(e.sync_status||null);
const agingOrders=onlineOrders.filter(o=>(Date.now()-new Date(o.createdAt).getTime())/3600000>48);
const refundValue=refundedOrders.reduce((s,r)=>s+(Number(r.amount)||0),0);
const syncTile=tile("Shopify Sync",si.tone,si.detail);
const pendingTile=tile("Unfulfilled Orders",0===onlineOrders.length?"good":onlineOrders.length<10?"warn":"bad",`${onlineOrders.length} order${1===onlineOrders.length?"":"s"} waiting, ${agingOrders.length} aged 48h+`);
const refundTile=tile("Refunds (30d)",0===refundedOrders.length?"good":refundedOrders.length<5?"warn":"bad",`${refundedOrders.length} refund${1===refundedOrders.length?"":"s"} totaling $${refundValue.toLocaleString()}`);
const attentionItems=[];
agingOrders.slice(0,8).forEach(o=>{const ageH=Math.round((Date.now()-new Date(o.createdAt).getTime())/3600000);attentionItems.push({text:`Order ${d(o.order||"")} (${d(o.customer||"Guest")}) — unfulfilled ${ageH}h`,view:"fulfillment"})});
refundedOrders.slice(0,5).forEach(r=>{attentionItems.push({text:`Refund on ${d(r.order||"")} (${d(r.customer||"Guest")}) — $${Number(r.amount||0).toLocaleString()}${r.reason?" — "+d(r.reason):""}`,view:"fulfillment"})});
return`
<p style="font-size:12.5px;color:var(--muted);margin:-4px 0 14px;">A read-only snapshot of fulfillment and returns activity already flowing into TCM Staff.</p>
<div class="panel" style="margin-bottom:16px;"><h3 style="margin-top:0;">Fulfillment Health</h3><div class="kpi-grid">${syncTile}${pendingTile}${refundTile}</div></div>
<div class="panel"><h3 style="margin-top:0;">Needs Attention</h3>${renderList(attentionItems)}</div>`
}
function CCInv(e){
const lots=e.merchandise_lots||[],activeLots=lots.filter(l=>l.stage!=="Listed"),AGING_DAYS=14;
const stageCounts={};LT.forEach(s=>stageCounts[s]=0);activeLots.forEach(l=>{if(l.stage in stageCounts)stageCounts[l.stage]++});
const agingLots=activeLots.filter(l=>{const hist=l.stageHistory||[],last=hist[hist.length-1];if(!last)return!1;return(Date.now()-new Date(last.enteredAt).getTime())/86400000>AGING_DAYS});
const agingValue=agingLots.reduce((s,l)=>s+(Number(l.purchasePrice)||0),0);
const pipelineValue=activeLots.reduce((s,l)=>s+(Number(l.estValue)||Number(l.purchasePrice)||0),0);
const si=syncInfo(e.sync_status||null);
const syncTile=tile("Shopify Sync",si.tone,si.detail);
const volumeTile=tile("Active Pipeline",0===activeLots.length?"warn":"good",`${activeLots.length} lot${1===activeLots.length?"":"s"} in progress, $${pipelineValue.toLocaleString()} est. value`);
const agingTile=tile("Aging Lots",0===agingLots.length?"good":agingLots.length<5?"warn":"bad",`${agingLots.length} lot${1===agingLots.length?"":"s"} stuck 14+ days ($${agingValue.toLocaleString()})`);
const stageLine=LT.map(s=>`${d(s)}: ${stageCounts[s]}`).join(" · ");
const attentionItems=[];
agingLots.slice(0,8).forEach(l=>{const hist=l.stageHistory||[],last=hist[hist.length-1],days=last?Math.round((Date.now()-new Date(last.enteredAt).getTime())/86400000):0;attentionItems.push({text:`${d(l.title||l.lotTag||"Lot")} — ${d(l.stage)} for ${days}d ($${Number(l.purchasePrice||0).toLocaleString()})`,view:"merchandise"})});
return`
<p style="font-size:12.5px;color:var(--muted);margin:-4px 0 14px;">A read-only snapshot of the buying/inventory pipeline already flowing into TCM Staff.</p>
<div class="panel" style="margin-bottom:16px;"><h3 style="margin-top:0;">Pipeline Health</h3><div class="kpi-grid">${syncTile}${volumeTile}${agingTile}</div></div>
<div class="panel" style="margin-bottom:16px;"><h3 style="margin-top:0;">By Stage</h3><p style="margin:0;color:var(--muted);font-size:13px;">${stageLine}</p></div>
<div class="panel"><h3 style="margin-top:0;">Needs Attention</h3>${renderList(attentionItems)}</div>`
}

function CCCX(e){
const rewards=e.reward_customers||[],collectors=e.collectors||[],refundedOrders=e.refunded_orders||[];
const goldCount=rewards.filter(c=>"Gold"===c.tier).length,silverCount=rewards.filter(c=>"Silver"===c.tier).length;
const withInterests=collectors.filter(c=>(c.interests||[]).length>0);
const si=syncInfo(e.sync_status||null);
const syncTile=tile("Shopify Sync",si.tone,si.detail);
const rewardsTile=tile("Rewards Tiers","off",`${goldCount} Gold, ${silverCount} Silver`);
const collectorsTile=tile("Recent Collectors","off",`${collectors.length} recent collector${1===collectors.length?"":"s"} tracked`);
const refundTile=tile("Refunds (30d)",0===refundedOrders.length?"good":refundedOrders.length<5?"warn":"bad",`${refundedOrders.length} refund${1===refundedOrders.length?"":"s"} may need follow-up`);
const attentionItems=[];
refundedOrders.slice(0,8).forEach(r=>{attentionItems.push({text:`Refund on ${d(r.order||"")} — ${d(r.customer||"Guest")} — $${Number(r.amount||0).toLocaleString()}${r.reason?" — "+d(r.reason):""}`})});
const oppItems=[];
withInterests.slice(0,8).forEach(c=>{oppItems.push({text:`${d(c.name||"")} — interested in ${(c.interests||[]).map(t=>d(t)).join(", ")}`,view:"crm"})});
if(goldCount)oppItems.push({text:`${goldCount} customer${1===goldCount?"":"s"} currently qualify for Gold tier — worth a VIP outreach pass.`,view:"rewards"});
return`
<p style="font-size:12.5px;color:var(--muted);margin:-4px 0 14px;">A read-only snapshot of rewards and recent customer activity already flowing into TCM Staff. There's no "last purchase" tracking yet, so at-risk customers can't be flagged automatically.</p>
<div class="panel" style="margin-bottom:16px;"><h3 style="margin-top:0;">Customer Health</h3><div class="kpi-grid">${syncTile}${rewardsTile}${collectorsTile}${refundTile}</div></div>
<div class="panel" style="margin-bottom:16px;"><h3 style="margin-top:0;">Needs Attention</h3>${renderList(attentionItems)}</div>
<div class="panel"><h3 style="margin-top:0;">Opportunities</h3>${renderList(oppItems)}</div>`
}
function CCMkt(e){
const cal=e.marketing_calendar||{},events=e.upcoming_events||[],categories=e.sales_by_category||[];
const si=syncInfo(e.sync_status||null);
const now=Date.now(),next7=[...Array(7)].map((_,i)=>new Date(now+i*86400000).toISOString().slice(0,10));
const coveredDays=next7.filter(dt=>(cal[dt]||[]).length>0).length,gapDays=next7.filter(dt=>!(cal[dt]||[]).length);
const upcoming7=events.filter(ev=>{const t=new Date(ev.when).getTime();return t>=now&&t<=now+7*86400000}).sort((a,b)=>new Date(a.when)-new Date(b.when));
const syncTile=tile("Shopify Sync",si.tone,si.detail);
const coverageTile=tile("Content Coverage (7d)",0===gapDays.length?"good":gapDays.length<=3?"warn":"bad",`${coveredDays}/7 days have scheduled content`);
const eventsTile=tile("Upcoming Events (7d)",0===upcoming7.length?"warn":"good",`${upcoming7.length} event${1===upcoming7.length?"":"s"} in the next week`);
const attentionItems=[];
gapDays.forEach(dt=>{attentionItems.push({text:`No content scheduled for ${d(new Date(dt).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}))}`,view:"calendar"})});
const oppItems=[];
if(categories[0])oppItems.push({text:`${d(categories[0].category)} is the top-selling category ($${categories[0].sales.toLocaleString()}) — worth featuring.`});
upcoming7.slice(0,5).forEach(ev=>{oppItems.push({text:`${d(ev.name||"")} — ${d(new Date(ev.when).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}))}`,view:"calendar"})});
return`
<p style="font-size:12.5px;color:var(--muted);margin:-4px 0 14px;">A read-only snapshot of the content calendar and upcoming events already in TCM Staff.</p>
<div class="panel" style="margin-bottom:16px;"><h3 style="margin-top:0;">Marketing Health</h3><div class="kpi-grid">${syncTile}${coverageTile}${eventsTile}</div></div>
<div class="panel" style="margin-bottom:16px;"><h3 style="margin-top:0;">Needs Attention</h3>${renderList(attentionItems)}</div>
<div class="panel"><h3 style="margin-top:0;">Opportunities</h3>${renderList(oppItems)}</div>`
}

return CC;
}
