import { channelDeliveryResult } from '../channel-delivery-result';
test.each([200,201,202,204,299])('HTTP %i confirms acceptance', status => expect(channelDeliveryResult(status)).toEqual({outcome:'delivered',status}));
test.each([400,401,403,404,410,413,422,429])('HTTP %i proves refusal', status => expect(channelDeliveryResult(status)).toEqual({outcome:'rejected',status}));
test.each([199,300,408,409,500,503])('HTTP %i does not authorize retry', status => expect(channelDeliveryResult(status).outcome).toBe('uncertain'));
test.each([null,undefined,'200',201.5,NaN])('unproven status %p is unknown', status => expect(channelDeliveryResult(status)).toEqual({outcome:'uncertain',status:null}));
