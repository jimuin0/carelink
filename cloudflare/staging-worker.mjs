import app from 'vinext/server/fetch-handler';
import { createStagingHandler } from './staging-handler.mjs';

export default createStagingHandler(app);
