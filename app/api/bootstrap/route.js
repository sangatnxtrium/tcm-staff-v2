import{NextResponse as o}
  from"next/server";import{cookies as r}
    from"next/headers";import{verifySession as e,SESSION_COOKIE as t}
    from"../../../lib/auth";import{ROLES as a,ROLE_HOME as n,allowedViewsForRole as i,VIEW_MODULES as m,GM_OR_ABOVE as gm}
    from"../../../lib/rbac";import{getModule as s,setModule as setMod}
    from"../../../lib/db";import{clearStoredStaffMemberErrors as clearErr}
    from"../../../lib/staffKpis";export async function GET(){const l=r().get(t)?.value,f=await e(l);if(!f)return o.json({error:"Not signed in"}
                                                                                                                 ,{status:401}
                                                                                                                 );const c=f.role,d=i(c),u=new Set;d.forEach(o=>(m[o]||[]).forEach(o=>u.add(o)));const p={}
    ;for(const o of u)p[o]=await s(o);const cleaned=await clearErr(s,setMod);for(const name of["staff_kpis","store_kpi_summary"]){if(Object.prototype.hasOwnProperty.call(p,name))p[name]=cleaned[name]}if(!gm.includes(c)){delete p.staff_sales;delete p.staff_kpis;delete p.staff_name_map}return o.json({me:{name:f.name,email:f.email,role:c}
                                                     ,roles:a,allowedViews:d,homeView:n[c]||d[0]||null,data:p}
                                                    )}
