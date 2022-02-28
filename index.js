/* VM manager server */

// imports
const jwt = require('jsonwebtoken');
const cors = require('cors');
const express = require('express');
const bodyParser = require('body-parser');
const virtualbox = require('virtualbox');
const {exec} = require("child_process");
let multer = require('multer');
const fs = require('fs');

// configure and run express.js
let app = express();
app.use(cors());

// for parsing application json
app.use(bodyParser.json({extended: true}));
app.use(bodyParser.urlencoded({extended: true}));

// for parsing multipart/form-data
app.use(express.static('public'));

// admin user
const accessTokenSecret = 'myAccessToken';
let users = [];


// on the request to root (localhost:8000/)
var upload = multer({dest: 'upload/'});

/** Permissible loading a single file,
 the value of the attribute "name" in the form of "file".
 **/
var type = upload.single('file')

app.post('/', type, async (req, res) => {
        //  setting headers


        res.setHeader('Content-Type', 'application/json');
    //------------------------------- json inputs ----------------------------------
    // getting data from request
    const {
        command, username, password, vmName, cpu, ram,
        sourceVmName, destVmName, input, destinationPath,
        originVM, destVM, originPath, destPath,file
    } = req.body;
    const vmNames = [vmName, sourceVmName, destVM, originVM, destVmName];
        //------------------------------- receiving file -------------------------------
        /** When using the "single"
         data come in "req.file" regardless of the attribute "name". **/
        if (command === "upload") {
            let tmp_path = req.file.path;


            /** The original name of the uploaded file
             stored in the variable "originalname". **/
            var target_path = 'uploads/' + req.file.originalname;

            /** A better way to copy the uploaded file.. **/
            let src = fs.createReadStream(tmp_path);
            let dest = fs.createWriteStream(target_path);
            src.pipe(dest);

            src.on('error', function (err) {
                res.write('error');
            });
        }

        // authentication and getting requests
        if (command === "login") {
            const user = users.find(u => {
                return u.password === password && u.username === username
            });
            if (!user) {
                // Generate an access token.
                const accessToken = jwt.sign({username, password}, accessTokenSecret);
                users.push({username: username, password: password, token: accessToken})
                res.json({
                    message: "Yay. You'r in!!." +
                        " send your requests.",
                    accessToken
                });
                console.log(`${username} joined!!`)

            } else {
                let token = user.token;

                res.json({
                    message: "Your are already in!!" +
                        " send your requests.",
                    token
                });
            }
        } else {
            let token = req.headers['token'];
            try {
                let decoded = jwt.verify(token, accessTokenSecret);
                let user = users.filter(u => u.username === decoded.username && u.password === decoded.password);
                if (user.length === 0) {
                    res.json({
                        err: "unauthorized!", message: ":user not found ! " +
                            " login again."
                    });
                    res.end();
                } else {
                    let hasAccess = user[0].username === "admin" && user[0].password === "123";
                    let isAnotherVmUsed = vmNames.filter((vm) => vm !== "VM1");

                    if (hasAccess || isAnotherVmUsed === []) {
                        switch (command) {
                            case "status":
                                await state(vmName, req, res);
                                break;
                            case "on":
                                await power(vmName, true, req, res)
                                break;
                            case "off":
                                await power(vmName, false, req, res);
                                break;
                            case "execute":
                                await execute(vmName, input, req, res);
                                break;
                            case "clone":
                                await cloneVm(sourceVmName, destVmName, req, res);
                                break;
                            case "delete":
                                await removeVn(vmName, req, res)
                                break;
                            case "setting":
                                await modifyVm(vmName, cpu, ram, req, res);
                                break;
                            case "upload":
                                await copyFileToVm(vmName, target_path, destinationPath, req.file.originalname, req, res);
                                break;
                            case "transfer":
                                await copyFileFromVmToVm(originVM, destVM, originPath, destPath, req, res);
                                break;
                        }
                    } else {
                        res.json({response: 403, message: "access denied"});
                        res.end();
                    }


                }


            } catch (err) {
                res.json({err: err.message, message: "unauthorized!!. Login again."});
                res.end();
                console.log(err);
            }

        }

    }
);

// ---------------------------------------------- Functions ----------------------------------------------
const state = async (vmName, req, res) => {
    console.log(await stateOfSingleOne(vmName))
    if (vmName) {
        res.json({
            ...req.body,
            status: await stateOfSingleOne(vmName) === -1 ? "vm does'not exist." : await stateOfSingleOne(vmName)
        });
        res.end();
    } else {
        virtualbox.list(async (vms, err) => {

            let result = Object.values(vms).map(async (vm) => {
                return {
                    vmName: vm.name,
                    status: await stateOfSingleOne(vm.name)
                }
            });
            res.json({
                ...req.body, details: await Promise.all(result)
            });
            res.end()


        });


    }

}
const isVmExist = (vmName) => {
    return new Promise((fulfill, rej) => {
        virtualbox.list(async (vms, err) => {
            let result = Object.values(vms).filter((vm) => vm.name === vmName);
            fulfill(result.length !== 0)

        });
    })


}
const stateOfSingleOne = async (vm) => {

    return new Promise(async (fulfill, rej) => {
        if (!await isVmExist(vm))
            fulfill(-1)

        else {
            let res = await execCommand(vm, "ls");
            virtualbox.isRunning(vm, (err, out) => {
                if (err)
                    fulfill(err.message)
                else {
                    if (res)
                        if (out)
                            fulfill("on");
                        else
                            fulfill(" powering off");
                    else if (out)
                        fulfill("powering on");
                    else
                        fulfill("off");
                }
            })
        }


    });
}
const execute = async (vm, cmd, req, res) => {
    if (await isVmExist(vm)) {
        const result = await execCommand(vm, cmd);
        res.json({
            ...req.body, status: result.includes("Command failed") ? "err" : "ok", response: result
        });
        res.end();
    } else {
        res.json({
            ...req.body, status: "error", response: `There is no vm name"${vm}"`
        });
        res.end();
    }
};
const execCommand = (vm, cmd) => {
    return new Promise((fulfilled, reject) => {
        virtualbox.exec({vm, cmd}, (error, stdout, stderr) => {
            if (error) {
                if (error.message.includes("VBoxManage.exe: error")) {
                    fulfilled(undefined);
                } else {
                    fulfilled(error.message.trim());
                }
            } else
                fulfilled(stdout.trim())

            if (stderr) {
                console.log(`stderr: ${stderr}`);
                fulfilled(`stderr: ${stderr}`);
            }
        })

    })
}
const power = async (vm, startFlag, req, res) => {
    virtualbox.isRunning(vm, (error, isRunning) => {
        console.log(isRunning)

        if (startFlag)
            virtualbox.start(vm, true, (err, out) => {
                if (err) {
                    console.log(err.message.trim());
                    res.json({...req.body, status: "Err", message: err.message})
                    res.end();
                } else {
                    console.log(`${vm} is running...`);
                    (res.json({
                        ...req.body, status: isRunning ? "already on!" : "powering on"
                    }));
                    res.end();
                }
            });
        else
            virtualbox.poweroff(vm, (err, out) => {
                if (err) {
                    console.log(err.message.trim());
                    res.json({...req.body, status: "already off!"})
                    res.end();
                } else {
                    console.log(`closing ${vm} ...`);
                    (res.json({
                        ...req.body, status: "powering off"
                    }))
                    res.end();
                }
            });

    })

}
const modifyVm = async (vm, cpus, memory, req, res) => {
    let state = await stateOfSingleOne(vm);
    if (state === "on" || state === "powering on" || state === -1) {
        res.json({
            ...req.body,
            status: "err",
            message: state === -1 ? "vm does'not exist." : "machine is running! power it off and try again."
        })
        res.end();
    } else {
        let command = `vboxmanage modifyvm "${vm}" `
        if (cpus)
            command += ` --cpus ${cpus}`;
        if (memory)
            command += ` --memory ${memory}`

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.log(`error: ${error.message}`);
                return;
            } else {
                (res.json({
                    ...req.body, status: "ok"
                }))
                res.end();
            }
            if (stderr) {
                console.log(`stderr: ${stderr}`);
                return;
            }
            console.log(`stdout: ${stdout}\n cpu cors : ${cpus}\n memory : ${memory}`);
        });
    }


}
const cloneVm = async (vm, cloneVm, req, res) => {
    if (await isVmExist(vm)) {
        let state = await stateOfSingleOne(vm);
        if (state === "on" || state === "powering on") {
            res.json({...req.body, status: "err", message: "machine is running! power it off and try again."})
            res.end();
        } else {
            virtualbox.clone(vm, cloneVm, (err, out) => {

                if (err) {
                    (res.json({
                        ...req.body, status: "Err", message: err.message.trim()
                    }))
                    res.end();
                } else {
                    console.log(`cloning ${cloneVm} from ${vm} ...`);
                    console.log(out, ` ${cloneVm} cloned!`);
                    (res.json({
                        ...req.body, status: "ok"
                    }))
                    res.end();
                }
            })

        }
    } else {
        res.json({
            ...req.body, status: "err", message: `There is no vm name "${vm}"`
        })
        res.end();

    }

}
const removeVn = async (vm, req, res) => {
    if (await isVmExist(vm)) {
        let state = await stateOfSingleOne(vm);
        if (state === "on" || state === "powering on") {
            res.json({...req.body, status: "err", message: "machine is running! power it off and try again."})
            res.end();
        } else {
            const command = `vboxmanage unregistervm ${vm} --delete`
            exec(command, (error, stdout, stderr) => {
                console.log(`removing ${vm}...`)
                if (error) {
                    console.log(`error: ${error.message}`);
                    (res.json({
                        ...req.body, status: "error", message: error.message.trim()
                    }));
                    res.end();
                    return;
                } else {
                    (res.json({
                        ...req.body, status: "ok"
                    }))
                    res.end();
                }
                if (stderr) {
                    console.log(`stderr: ${stderr}`);
                    return;
                }
                console.log(`stdout: ${stdout}\n cpu cors : ${cpus}\n memory : ${memory}`);
            });
        }
    } else {
        (res.json({
            ...req.body, status: "err", message: `There is no vm name "${vm}"`
        }));
        res.end();

    }
}
const copyFileToVm = async (vm, sourcePath, destinationPath, destinationFilename, req, res) => {
    let state = await stateOfSingleOne(vm);
    if (state === "off" || state === "powering off" || state === -1) {
        res.json({
            ...req.body,
            status: "err",
            message: state === -1 ? `vm "${vm}" does not exist.` : `${vm} is not running! power it on and try again.`
        })
        res.end();
        return false;

    } else {
        let cmd = `vboxmanage guestcontrol "${vm}" --username Guest copyto "${sourcePath}" "${destinationPath}${destinationFilename}" `;
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.log(`error: ${error.message}`);
                res.json({
                    ...req.body, status: "err", message: error.message.trim()
                });
                res.end()
            } else {
                console.log(`coping file from  ${sourcePath} in ${vm} to ${destinationPath}${destinationFilename}\n `);
                console.log("done");
                res.json({
                    ...req.body, status: "ok"
                });
                res.end()

            }

        });
    }
    return true;

}
const copyFileFromVm = async (vm, sourcePath, destinationPath, destinationFilename, req, res) => {
    let state = await stateOfSingleOne(vm);
    if (state === "off" || state === "powering off" || state === -1) {
        res.json({
            ...req.body,
            status: "err",
            message: state === -1 ? `vm "${vm}" does not exist.` : `${vm} is not running! power it on and try again.`
        });
        res.end();
        return false;
    } else {
        let cmd = `vboxmanage guestcontrol "${vm}" --username Guest copyfrom "${sourcePath}" "${destinationPath}\\${destinationFilename}" `;
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                res.json({...req.body, status: "err", message: error.message.trim()});
                res.end();
                console.log(`error: ${error.message}`);
                return;
            } else {
                console.log("done");
            }
            if (stderr) {
                console.log(`stderr: ${stderr}`);
                return;
            }
            console.log(`coping file from  ${sourcePath} in ${vm} to ${destinationPath}\\${destinationFilename}\n `);
        });
    }
    return true;


}
const copyFileFromVmToVm = async (sourceVm, destinationVm, sourcePath, destinationPath, req, res) => {
    let arr = sourcePath.split("/");
    let fileName = arr[arr.length - 1];
    let tmpDestination = ".\\VmsTmpData";

    await copyFileFromVm(sourceVm, sourcePath, tmpDestination, fileName, req, res).then((done) =>
        done ? setTimeout(async () => await copyFileToVm(destinationVm, tmpDestination + "\\" + fileName, destinationPath, fileName, req, res), 1000) : undefined
    )
}

//start the server in the port 8000 !
app.listen(8000, function () {
    console.log('Example app listening on port 8000.');
});


