'use client';
import {IdentityBadge,type BadgeVariant} from './football-identity';
// Legacy callers may pass provider logo fields; only the central cleared registry is used.
export default function TeamBadge({id,name,size,variant}:{id?:string;name:string;logo?:string|null;size?:number;variant?:BadgeVariant}){return <IdentityBadge id={id} name={name} size={size} variant={variant}/>;}
