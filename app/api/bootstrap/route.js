import{NextResponse as o}
  from"next/server";import{cookies as r}
    from"next/headers";import{verifySession as e,SESSION_COOKIE as t}
    from"../../../lib/auth";import{ROLES as a,ROLE_HOME as n,allowedViewsForRole as i,VIEW_MODULES as m,GM_OR_ABOVE as gm}
    from"../../../lib/rbac";import{getModule as s}
    from"../../../lib/db";export async function GET(){const l=r().get(t)?.value,f=await e(l);if(!f)return o.json({error:"Not signed in"}
                                                                                                                 ,{status:401}
                                                                                                                 );const c=f.role,d=i(c),u=new Set;d.forEach(o=>(m[o]||[]).forEach(o=>u.add(o)));const p={}
    ;for(const o of u)p[o]=await s(o);if(!gm.includes(c)){delete p.staff_sales;delete p.staff_kpis;delete p.staff_name_map}return o.json({me:{name:f.name,email:f.email,role:c}
                                                     ,roles:a,allowedViews:d,homeView:n[c]||d[0]||null,data:p}
                                                    )}
