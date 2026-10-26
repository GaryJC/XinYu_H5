import {processRepairWritebacks} from '../repositories/repairWritebackRepository.mjs';
import {transaction} from '../database/pool.mjs';
import {writebackEnabled} from '../domain/repairWriteback.mjs';
import {replaceLegacyRepairItems} from '../repositories/legacyRepairWritebackRepository.mjs';
import {repairWritebackSimulationEnabled} from '../domain/repairWritebackSimulation.mjs';
import {processRepairWritebackSimulations} from '../repositories/repairWritebackSimulationRepository.mjs';
let running,started=false,stopping=false;
export function wakeRepairWriteback() {
 if(!started||stopping||!repairWritebackSimulationEnabled()&&!writebackEnabled())return;
 if(!running)running=drainRepairWritebacks({shouldContinue:()=>!stopping}).catch(error=>console.error('润丰检验写回:',error.message)).finally(()=>{running=undefined;});
}
export async function drainRepairWritebacks({runTransaction=transaction,write=replaceLegacyRepairItems,shouldContinue=()=>true}={}) {
 if(repairWritebackSimulationEnabled())return processRepairWritebackSimulations(runTransaction,shouldContinue);
 return processRepairWritebacks(runTransaction,write,shouldContinue);
}
export function startRepairWritebacks() {
 repairWritebackSimulationEnabled(); // Fail at startup rather than silently use a real writer.
 started=true;stopping=false;wakeRepairWriteback();
 // Recovery belongs to H5; the legacy polling consumer is not involved.
 const timer=setInterval(wakeRepairWriteback,60000);timer.unref();
 return async()=>{stopping=true;started=false;clearInterval(timer);await running;};
}
