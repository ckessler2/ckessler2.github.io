 function [x_,y_,tSol,v_yp,v_xp,omega,theta] = Alsomitra_nondim3(p)
    
    % display(opt)
    % opt= [4.9794    0.7787    0.1671    5.8387    1.8170    0.2574    6.5168    0.3347    2.9944];
    
    % define the initial conditions 
    
    % non dimensional period of oscillation T
    T = 1;
    % f = 999;
    % number of periods
    n = 300; % Cathal's % 
    % n = 1; % mine
    
    % amp = 999;
    % per = 999;
    % slope = 999;
    % 
    % time interval over which to solve the ODEs (non-dimensional)
    
    % t = 0:T/(10^3):n*T;
    
    % initial conditions for v_xp, v_yp, omega, theta, x, y
    % eps in Matlab gives a value close to 0
    % Y0 = [0; 0; 0; deg2rad(-20); 0.; 0.]; % Validation of Li et al.
    Y0 = [0; 0; 0; 0.; 0.; 0.];
    
    t_start = 15;
    t_G = 1;

    t1 = [0, t_start];
    t2 = [t_start, t_start + t_G];
    t3 = [t_start + t_G, n*T];

    opts1 = odeset('RelTol',1e-8,'AbsTol',1e-10,'MaxStep',t_G/500);
    opts2 = odeset('RelTol',1e-8,'AbsTol',1e-10,'MaxStep',t_G/1000);
    opts3 = odeset('RelTol',1e-8,'AbsTol',1e-10,'MaxStep',t_G/500);

    [tSol1, ySol1] = ode45(@(t,y) nondimfreelyfallingplate(t,y,p), t1, Y0, opts1);

    Y1 = ySol1(end,:).';
    [tSol2, ySol2] = ode45(@(t,y) nondimfreelyfallingplate(t,y,p), t2, Y1, opts2);

    Y2 = ySol2(end,:).';
    [tSol3, ySol3] = ode45(@(t,y) nondimfreelyfallingplate(t,y,p), t3, Y2, opts3);

    tSol = [tSol1; tSol2(2:end); tSol3(2:end)];
    ySol = [ySol1; ySol2(2:end,:); ySol3(2:end,:)];

    

    % extract the single variables from the vector with the solutions
    % x component of velocity in the reference system of the body
    v_xp = ySol(:,1);
    % y component of velocity in the reference system of the body
    v_yp = ySol(:,2);
    % omega, first derivative of theta
    omega = ySol(:,3);
    % theta angle defined in Fig.2
    theta = ySol(:,4);
    % x, horizontal coordinate in reference system linked to the lab
    x_ = ySol(:,5);
    % y, horizontal coordinate in reference system linked to the lab
    y_ = ySol(:,6);