/** Local synthetic receipt consistency probe (two requests for ONE fixed intent).
 * This is not a proof of DB cardinality; the PG17 concurrency gate verifies that.
 * Requires an explicitly seeded fixture manifest and independently verified
 * local DB + provider-blocked runtime. No production load is permitted.
 * k6 run -e TARGET_URL=http://localhost:3309 -e CARELINK_BOOKING_FIXTURE_FILE=/absolute/local/fixture.json concurrent-booking.js
 */
import http from 'k6/http';
import { requireLocalLoadTarget } from './local-target.mjs';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
const BASE_URL=requireLocalLoadTarget(__ENV.TARGET_URL);
if(!__ENV.CARELINK_BOOKING_FIXTURE_FILE)throw Error('Explicit isolated synthetic booking fixture manifest required');
const fixture=JSON.parse(open(__ENV.CARELINK_BOOKING_FIXTURE_FILE));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
if(fixture.kind!=='carelink-isolated-booking-v2' || fixture.database!=='isolated-pg17' || fixture.providerPolicy!=='loopback-only'
 || ![fixture.facilityId,fixture.menuId,fixture.staffId,fixture.operationId].every(value=>typeof value==='string'&&uuid.test(value))
 || typeof fixture.slug!=='string' || !/^synthetic-load-[a-f0-9-]+$/.test(fixture.slug)
 || fixture.facilityName!==`Synthetic load ${fixture.facilityId}`)throw Error('Invalid isolated synthetic fixture identity');
const date=new Date(`${fixture.bookingDate}T00:00:00Z`);
const today=new Date(Date.now()+9*3600000);const min=today.toISOString().slice(0,10);today.setUTCFullYear(today.getUTCFullYear()+1);const max=today.toISOString().slice(0,10);
if(!/^\d{4}-\d{2}-\d{2}$/.test(fixture.bookingDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==fixture.bookingDate
 || fixture.bookingDate<min || fixture.bookingDate>max || ![fixture.startTime,fixture.endTime].every(value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) || fixture.startTime>=fixture.endTime)throw Error('Fixture must use a valid prepared slot within the current API date range');
export const options={maxRedirects:0,scenarios:{same_intent:{executor:'shared-iterations',vus:2,iterations:2,maxDuration:'45s'}},thresholds:{receipt_mismatches:['count==0']}};
const mismatches=new Counter('receipt_mismatches');
const payload=JSON.stringify({facility_id:fixture.facilityId,staff_id:fixture.staffId,menu_id:fixture.menuId,menu_ids:[fixture.menuId],coupon_id:null,
 booking_date:fixture.bookingDate,start_time:fixture.startTime,end_time:fixture.endTime,customer_name:'Synthetic load receipt',email:'synthetic-load@example.invalid',phone:null,note:null,total_price:null,points_used:0});
const headers=action=>({'Content-Type':'application/json',Origin:BASE_URL,'X-Booking-Action':action,'Idempotency-Key':fixture.operationId});
function accepted(response){try{const v=response.json();return response.status===200&&v.success===true&&v.state==='accepted'&&v.operationId===fixture.operationId&&uuid.test(v.bookingId)?v:null;}catch{return null;}}
export function setup(){
 const page=http.get(`${BASE_URL}/facility/${fixture.slug}/booking`,{redirects:0});const csp=page.headers['Content-Security-Policy']||page.headers['content-security-policy']||'';
 if(page.status!==200 || !/https?:\/\/(?:127\.0\.0\.1:54321|localhost:54321|localhost:54330)(?:\s|;|$)/.test(csp)
  || !page.body.includes(fixture.facilityName) || !page.body.includes(fixture.facilityId) || !page.body.includes(fixture.menuId))throw Error('Runtime does not expose the declared isolated synthetic fixture');
 const context=http.post(`${BASE_URL}/api/booking`,null,{headers:headers('context'),redirects:0,timeout:'15s'});
 const cookie=context.cookies.carelink_booking_scope?.[0]?.value;
 if(context.status!==200 || context.json().state!=='context_ready' || typeof cookie!=='string' || !/^[\w-]{43}$/.test(cookie))throw Error('Guest context not established');
 const prepared=http.post(`${BASE_URL}/api/booking`,payload,{headers:headers('prepare'),redirects:0,timeout:'15s'});
 if(prepared.status!==200 || prepared.json().state!=='prepared' || prepared.json().operationId!==fixture.operationId)throw Error('Fresh fixed receipt key not prepared; never regenerate an uncertain key');
 return {scope:cookie}; // Ephemeral local test cookie only; never printed or written to a file.
}
export default function(data){
 http.cookieJar().set(BASE_URL,'carelink_booking_scope',data.scope);
 const response=http.post(`${BASE_URL}/api/booking`,payload,{headers:headers('create'),redirects:0,timeout:'20s'});const created=accepted(response);
 check(response,{'accepted exact receipt':()=>created!==null});
 if(!created){mismatches.add(1);return;}
 const lookup=accepted(http.post(`${BASE_URL}/api/booking`,null,{headers:headers('status'),redirects:0,timeout:'15s'}));
 if(!lookup || lookup.bookingId!==created.bookingId)mismatches.add(1);else mismatches.add(0);
}
export function handleSummary(data){return{stdout:JSON.stringify({probe:'same-intent receipt response consistency',mismatches:data.metrics.receipt_mismatches?.values?.count??0,
 databaseCardinality:'verified by scripts/check-booking-create-concurrency.mjs, not inferred from HTTP counts'},null,2)+'\n'};}
