import test from 'node:test';
import assert from 'node:assert/strict';
import {binaryMetrics} from '../../scripts/evaluation/binary.mjs';
test('binary scores and calibration have the documented scale',()=>{
 const m=binaryMetrics([{probability:0.8,outcome:1},{probability:0.2,outcome:0}]);
 assert.equal(m.count,2);assert.equal(m.accuracy,1);
 assert.ok(Math.abs(m.brier-0.04)<1e-12);assert.ok(Math.abs(m.logLoss+Math.log(0.8))<1e-12);
 assert.deepEqual(m.calibration.map(b=>[b.count,b.predicted,b.observed]),[[1,0.2,0],[1,0.8,1]]);
});
test('ties and empty samples do not imply predictive accuracy',()=>{
 const m=binaryMetrics([{probability:0.5,outcome:1}]);assert.equal(m.accuracy,null);assert.equal(m.tiedPicks,1);assert.equal(m.brier,0.25);
 assert.equal(binaryMetrics([]).accuracy,null);
});
test('invalid probabilities and outcomes cannot enter metrics',()=>{
 for(const r of [{probability:1.1,outcome:1},{probability:NaN,outcome:0},{probability:0.5,outcome:2}])assert.throws(()=>binaryMetrics([r]),/Invalid/);
 assert.ok(Number.isFinite(binaryMetrics([{probability:0,outcome:1}]).logLoss));
});
