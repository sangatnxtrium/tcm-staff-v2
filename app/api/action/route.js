import{NextResponse as t}
  from"next/server";import{cookies as e}
    from"next/headers";import{verifySession as a,SESSION_COOKIE as n}
    from"../../../lib/auth";import{canPerformAction as r,GM_OR_ABOVE as s}
    from"../../../lib/rbac";import{getModule as o,setModule as i}
    from"../../../lib/db";import{BUY_STAGES as d,INV_STAGES as u}
    from"../../../lib/seedData";function c(){return(new Date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}
                                                                                 )}
function m(t){try{const e=new URL(t);return"https:"===e.protocol&&e.hostname.endsWith("blob.vercel-storage.com")}
              catch{return!1}
             }
export async function POST(l){const h=e().get(n)?.value,g=await a(h);if(!g)return t.json({error:"Not signed in"}
                                                                                         ,{status:401}
                                                                                         );const f=g.role;let y;try{y=await l.json()}
                              catch{return t.json({error:"Invalid request body"}
                                                  ,{status:400}
                                                  )}
                              const{type:p}
                              =y||{}
                                ;if(!p||!r(f,p))return t.json({error:`Role "${f}
                                " is not permitted to perform "${p}
                                "`}
                                                              ,{status:403}
                                                              );try{switch(p){case"moveBuyingLead":{const{id:e,stage:a}
                                                                                                    =y,n=await o("buying_leads")||[],r=n.find(t=>t.id===e);return r?(r.stage=a,r.daysInStage=0,await i("buying_leads",n),t.json({ok:!0,data:n}
                                                                                                                                                                                                                                )):t.json({error:"Lead not found"}
                                                                                                                                                                                                                                          ,{status:404}
                                                                                                                                                                                                                                          )}
                                  case"moveInventoryItem":{const{id:e,stage:a}
                                                           =y,n=await o("inventory_items")||[],r=n.find(t=>t.id===e);return r?(r.stage=a,r.daysInStage=0,await i("inventory_items",n),t.json({ok:!0,data:n}
                                                                                                                                                                                             )):t.json({error:"Item not found"}
                                                                                                                                                                                                       ,{status:404}
                                                                                                                                                                                                       )}
                                  case"addBuyingLead":{const{title:e,customer:a,value:n,closer:r}
                                                       =y;if(!e)return t.json({error:"Title is required"}
                                                                              ,{status:400}
                                                                              );const s=await o("buying_leads")||[],u=s.length?Math.max(...s.map(t=>t.id))+1:1;return s.push({id:u,title:e,customer:a||"—",value:Number(n)||0,closer:r||f,stage:d[0],daysInStage:0}
                                                                                                                                                                             ),await i("buying_leads",s),t.json({ok:!0,data:s}
                                                                                                                                                                                                                )}
                                  case"addInventoryItem":{const{title:e,items:a,source:n}
                                                          =y;if(!e)return t.json({error:"Title is required"}
                                                                                 ,{status:400}
                                                                                 );const r=await o("inventory_items")||[],s=r.length?Math.max(...r.map(t=>t.id))+1:1;return r.push({id:s,title:e,items:Number(a)||1,source:n||"—",stage:u[0],daysInStage:0}
                                                                                                                                                                                   ),await i("inventory_items",r),t.json({ok:!0,data:r}
                                                                                                                                                                                                                         )}
                                  case"postChatMessage":{const{channelId:e,body:a,imageData:n}
                                                         =y,r=(a||"").trim();if(!r&&!n)return t.json({error:"Message cannot be empty"}
                                                                                                     ,{status:400}
                                                                                                     );if(n){if("string"!=typeof n||!n.startsWith("data:image/"))return t.json({error:"Invalid image data"}
                                                                                                                                                                               ,{status:400}
                                                                                                                                                                               );if(n.length>2e6)return t.json({error:"Image is too large (2MB max)"}
                                                                                                                                                                                                               ,{status:400}
                                                                                                                                                                                                               )}
                                                         const s=await o("chat_messages")||[],d=s.length?Math.max(...s.map(t=>t.id))+1:1;return s.push({id:d,channelId:e,author:g.name,authorEmail:g.email,role:f,body:r,imageUrl:n||null,ts:(new Date).toISOString()}
                                                                                                                                                       ),await i("chat_messages",s),t.json({ok:!0,data:s.filter(t=>t.channelId===e)}
                                                                                                                                                                                           )}
                                  case"editChatMessage":{const{channelId:e,messageId:a,body:n}
                                                         =y,r=(n||"").trim();if(!r)return t.json({error:"Message cannot be empty"}
                                                                                                 ,{status:400}
                                                                                                 );const d=await o("chat_messages")||[],u=d.find(t=>t.id===a);if(!u)return t.json({error:"Message not found"}
                                                                                                                                                                                  ,{status:404}
                                                                                                                                                                                  );return(u.authorEmail?u.authorEmail===g.email:u.author===g.name)||s.includes(f)?(u.body=r,u.editedAt=(new Date).toISOString(),await i("chat_messages",d),t.json({ok:!0,data:d.filter(t=>t.channelId===(e??u.channelId))}
                                                                                                                                                                                                                                                                                                                                                   )):t.json({error:"You can only edit your own messages"}
                                                                                                                                                                                                                                                                                                                                                             ,{status:403}
                                                                                                                                                                                                                                                                                                                                                             )}
                                  case"deleteChatMessage":{const{channelId:e,messageId:a}
                                                           =y,n=await o("chat_messages")||[],r=n.find(t=>t.id===a);if(!r)return t.json({error:"Message not found"}
                                                                                                                                       ,{status:404}
                                                                                                                                       );if(!(r.authorEmail?r.authorEmail===g.email:r.author===g.name)&&!s.includes(f))return t.json({error:"You can only delete your own messages"}
                                                                                                                                                                                                                                     ,{status:403}
                                                                                                                                                                                                                                     );const d=n.filter(t=>t.id!==a);return await i("chat_messages",d),t.json({ok:!0,data:d.filter(t=>t.channelId===(e??r.channelId))}
                                                                                                                                                                                                                                                                                                              )}
                                  case"addChatChannel":{const{name:e,description:a}
                                                        =y;if(!e||!e.trim())return t.json({error:"Channel name is required"}
                                                                                          ,{status:400}
                                                                                          );const n=await o("chat_channels")||[],r=n.length?Math.max(...n.map(t=>t.id))+1:1,s=e.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");return n.push({id:r,name:s||e.trim(),description:a||""}
                                                                                                                                                                                                                                                                     ),await i("chat_channels",n),t.json({ok:!0,data:n}
                                                                                                                                                                                                                                                                                                         )}
                                  case"editChatChannel":{const{id:e,name:a,description:n}
                                                         =y;if(!e)return t.json({error:"Channel id is required"}
                                                                                ,{status:400}
                                                                                );const r=await o("chat_channels")||[],d=r.find(t=>t.id===e);if(!d)return t.json({error:"Channel not found"}
                                                                                                                                                                 ,{status:404}
                                                                                                                                                                 );if(a&&a.trim()){const l=a.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");d.name=l||a.trim()}
                                                         return void 0!==n&&(d.description=n||""),await i("chat_channels",r),t.json({ok:!0,data:r}
                                                                                                                                    )}
                                  case"deleteChatChannel":{const{id:e}
                                                           =y,a=await o("chat_channels")||[];if(a.length<=1)return t.json({error:"You can't delete the last channel"}
                                                                                                                          ,{status:400}
                                                                                                                          );const n=a.filter(t=>t.id!==e);await i("chat_channels",n);const r=await o("chat_messages")||[],d=r.filter(t=>t.channelId!==e);return await i("chat_messages",d),t.json({ok:!0,data:n}
                                                                                                                                                                                                                                                                                                  )}
                                  case"addCalendarContent":{const{day:e,title:a}
                                                            =y;if(!e||!a)return t.json({error:"Day and title are required"}
                                                                                       ,{status:400}
                                                                                       );const n=await o("marketing_calendar")||{}
                                    ;return n[e]=n[e]||[],n[e].push({title:a,automated:!1}
                                                                    ),await i("marketing_calendar",n),t.json({ok:!0,data:n}
                                                                                                             )}
                                  case"addCalendarEvent":{const{name:e,when:a}
                                                          =y;if(!e||!a)return t.json({error:"Name and date are required"}
                                                                                     ,{status:400}
                                                                                     );const n=await o("upcoming_events")||[];return n.push({name:e,when:a}
                                                                                                                                            ),await i("upcoming_events",n),t.json({ok:!0,data:n}
                                                                                                                                                                                  )}
                                  case"addShift":{const{day:e,assignees:a,note:n}
                                                  =y;if(!e)return t.json({error:"Day is required"}
                                                                         ,{status:400}
                                                                         );const r=await o("shift_schedule")||{}
                                    ;return r[e]={assignees:Array.isArray(a)?a.filter(Boolean):[],note:n||""}
                                                  ,await i("shift_schedule",r),t.json({ok:!0,data:r}
                                                                                      )}
                                  case"addDoc":{const{cat:e,title:a,docBody:n,pinned:r,attachmentData:s,attachmentName:d}
                                                =y;if(!a||!n&&!s)return t.json({error:"Title and either a body or an attachment are required"}
                                                                               ,{status:400}
                                                                               );if(s&&!m(s))return t.json({error:"Invalid attachment URL"}
                                                                                                           ,{status:400}
                                                                                                           );const u=await o("docs")||[],l=u.length?Math.max(...u.map(t=>t.id))+1:1;return u.push({id:l,cat:e||"General",title:a,updated:c(),body:n||"",pinned:!!r,attachmentUrl:s||null,attachmentName:s?d||"attachment":null}
                                                                                                                                                                                                  ),await i("docs",u),t.json({ok:!0,data:u}
                                                                                                                                                                                                                             )}
                                  case"editDoc":{const{id:e,cat:a,title:n,docBody:r,pinned:s,attachmentData:d,attachmentName:u}
                                                 =y,l=await o("docs")||[],h=l.find(t=>t.id===e);if(!h)return t.json({error:"Doc not found"}
                                                                                                                    ,{status:404}
                                                                                                                    );if(n&&(h.title=n),a&&(h.cat=a),r&&(h.body=r),"boolean"==typeof s&&(h.pinned=s),null===d)h.attachmentUrl=null,h.attachmentName=null;else if(d){if(!m(d))return t.json({error:"Invalid attachment URL"}
                                                                                                                                                                                                                                                                                           ,{status:400}
                                                                                                                                                                                                                                                                                           );h.attachmentUrl=d,h.attachmentName=u||"attachment"}
                                                 return h.updated=c(),await i("docs",l),t.json({ok:!0,data:l}
                                                                                               )}
                                  case"toggleDocPinned":{const{id:e}
                                                         =y,a=await o("docs")||[],n=a.find(t=>t.id===e);return n?(n.pinned=!n.pinned,await i("docs",a),t.json({ok:!0,data:a}
                                                                                                                                                              )):t.json({error:"Doc not found"}
                                                                                                                                                                        ,{status:404}
                                                                                                                                                                        )}
                                  case"toggleProjectMilestone":case"toggleProjectTask":{const{projectId:e,itemId:a}
                                                                                        =y,n=await o("projects")||[],r=n.find(t=>t.id===e);if(!r)return t.json({error:"Project not found"}
                                                                                                                                                               ,{status:404}
                                                                                                                                                               );if(!s.includes(f)&&f!==r.owner)return t.json({error:"Only the project owner, Operations Manager, or Owner can update this"}
                                                                                                                                                                                                              ,{status:403}
                                                                                                                                                                                                              );const l="toggleProjectMilestone"===p?r.milestones:r.tasks,c=(l||[]).find(t=>t.id===a);if(!c)return t.json({error:"Item not found"}
                                                                                                                                                                                                                                                                                                                          ,{status:404}
                                                                                                                                                                                                                                                                                                                          );return c.done=!c.done,await i("projects",n),t.json({ok:!0,data:n}
                                                                                                                                                                                                                                                                                                                                                                               )}
                                  case"toggleSprintGoal":{const{sprintId:e,goalId:a}
                                                          =y,n=await o("sprints")||[],r=n.find(t=>t.id===e);if(!r)return t.json({error:"Sprint not found"}
                                                                                                                                ,{status:404}
                                                                                                                                );if(!s.includes(f)&&f!==r.role)return t.json({error:"You can only update your own sprint"}
                                                                                                                                                                              ,{status:403}
                                                                                                                                                                              );const l=(r.goals||[]).find(t=>t.id===a);if(!l)return t.json({error:"Goal not found"}
                                                                                                                                                                                                                                            ,{status:404}
                                                                                                                                                                                                                                            );l.done=!l.done,await i("sprints",n);const c=s.includes(f)?n:n.filter(t=>t.role===f);return t.json({ok:!0,data:c}
                                                                                                                                                                                                                                                                                                                                                )}
                                  case"addProject":{const{name:e,owner:a,status:n}
                                                    =y;if(!e)return t.json({error:"Name is required"}
                                                                           ,{status:400}
                                                                           );const r=s.includes(f)&&a?a:f,l=await o("projects")||[],c=l.length?Math.max(...l.map(t=>t.id))+1:1;return l.push({id:c,name:e,owner:r,status:n||"Planning",milestones:[],tasks:[]}
                                                                                                                                                                                             ),await i("projects",l),t.json({ok:!0,data:l}
                                                                                                                                                                                                                            )}
                                  case"addProjectMilestone":case"addProjectTask":{const{projectId:e,title:a}
                                                                                  =y;if(!a)return t.json({error:"Title is required"}
                                                                                                         ,{status:400}
                                                                                                         );const n=await o("projects")||[],r=n.find(t=>t.id===e);if(!r)return t.json({error:"Project not found"}
                                                                                                                                                                                     ,{status:404}
                                                                                                                                                                                     );if(!s.includes(f)&&f!==r.owner)return t.json({error:"Only the project owner, Operations Manager, or Owner can add to this"}
                                                                                                                                                                                                                                    ,{status:403}
                                                                                                                                                                                                                                    );const l="addProjectMilestone"===p?r.milestones=r.milestones||[]:r.tasks=r.tasks||[],c=l.length?Math.max(...l.map(t=>t.id))+1:1;return l.push({id:c,title:a,done:!1}
                                                                                                                                                                                                                                                                                                                                                                                   ),await i("projects",n),t.json({ok:!0,data:n}
                                                                                                                                                                                                                                                                                                                                                                                                                  )}
                                  case"addSprint":{const{role:e,sprintLabel:a}
                                                   =y;if(!a)return t.json({error:"Sprint label is required"}
                                                                          ,{status:400}
                                                                          );const n=s.includes(f)&&e?e:f,r=await o("sprints")||[],l=r.length?Math.max(...r.map(t=>t.id))+1:1;r.push({id:l,role:n,sprintLabel:a,goals:[]}
                                                                                                                                                                                    ),await i("sprints",r);const c=s.includes(f)?r:r.filter(t=>t.role===f);return t.json({ok:!0,data:c}
                                                                                                                                                                                                                                                                         )}
                                  case"addSprintGoal":{const{sprintId:e,text:a}
                                                       =y;if(!a)return t.json({error:"Goal text is required"}
                                                                              ,{status:400}
                                                                              );const n=await o("sprints")||[],r=n.find(t=>t.id===e);if(!r)return t.json({error:"Sprint not found"}
                                                                                                                                                         ,{status:404}
                                                                                                                                                         );if(!s.includes(f)&&f!==r.role)return t.json({error:"You can only update your own sprint"}
                                                                                                                                                                                                       ,{status:403}
                                                                                                                                                                                                       );r.goals=r.goals||[];const l=r.goals.length?Math.max(...r.goals.map(t=>t.id))+1:1;r.goals.push({id:l,text:a,done:!1}
                                                                                                                                                                                                                                                                                                       ),await i("sprints",n);const c=s.includes(f)?n:n.filter(t=>t.role===f);return t.json({ok:!0,data:c}
                                                                                                                                                                                                                                                                                                                                                                                            )}
                                  case"toggleAutomation":{const{id:e}
                                                          =y,a=await o("automations")||[],n=a.find(t=>t.id===e);return n?(n.enabled=!n.enabled,await i("automations",a),t.json({ok:!0,data:a}
                                                                                                                                                                               )):t.json({error:"Automation not found"}
                                                                                                                                                                                         ,{status:404}
                                                                                                                                                                                         )}
                                default:return t.json({error:"Unknown action type"}
                                                      ,{status:400}
                                                      )}
                                                                   }
                              catch(e){return t.json({error:e.message||"Server error"}
                                                     ,{status:500}
                                                     )}
                             }
