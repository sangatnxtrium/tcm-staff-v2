import{NextResponse as r}
  from"next/server";import{cookies as t}
    from"next/headers";import{verifySession as e,SESSION_COOKIE as n}
    from"../../../../lib/auth";import{getModule as a}
    from"../../../../lib/db";export async function GET(s){const o=t().get(n)?.value;if(!await e(o))return r.json({error:"Not signed in"}
                                                                                                                 ,{status:401}
                                                                                                                 );const{searchParams:i}
                                                          =new URL(s.url),c=parseInt(i.get("channelId"),10);if(!c)return r.json({error:"channelId is required"}
                                                                                                                                ,{status:400}
                                                                                                                                );const m=await a("chat_messages")||[];return r.json({data:m.filter(r=>r.channelId===c)}
                                                                                                                                                                                     )}
