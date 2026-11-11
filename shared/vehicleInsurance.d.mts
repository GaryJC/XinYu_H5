export function insuranceToday(now?:Date):string;
export function insuranceState(car:{insuranceStart?:string;insuranceEnd?:string},today?:string):string;
export function insuranceReminder(end:string,today?:string):number|null;
