import{NextResponse as t}
  from"next/server";import{SESSION_COOKIE as o}
    from"../../../../lib/auth";export async function POST(){const r=t.json({ok:!0}
                                                                           );return r.cookies.set(o,"",{httpOnly:!0,path:"/",maxAge:0}
                                                                                                  ),r}
