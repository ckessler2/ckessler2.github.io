function [dydt] = nondimfreelyfallingplate(t, y, p)
   

    % Extract v_xp, v_yp, omega, theta x_ and y_ from input vector y
    v_xp = y(1);
    v_yp = y(2);
    omega = y(3);
    theta = y(4);
    x_ = y(5);
    y_ = y(6);
    
    l = p(1);
    h = p(2);
    rho_s = p(3); % % % p(3) = 1.4*10^3; % p(3) = 1.4 LiJFM2022 
    rho_f = p(4);    % % % p(4) = 1.225; % p(4) = 1.225*10^-3; LiJFM2022 
    l_CE = p(5);     % % % p(5) = p(1)*0.0;
    e_x = p(6);       % % % p(6) = 0.00;
    g = p(7);      % % % p(7) = 9.80665; % p(7) = 980.665;
    nu = p(9);

    % Earth-fixed horizontal and vertical velocities

    dx_dt = v_xp.*cos(theta) - v_yp.*sin(theta);
    
    dy_dt = v_xp.*sin(theta) + v_yp.*cos(theta);
    

    % Solid-to-fluid density ratio(non-dimensional)

    rho = rho_s/rho_f;
    
    % Magnitude of Gravitational Velocity (dimensional)

    U_g = sqrt((rho - 1) * g * h);
    
    % Vertical and Horizonatal Re

    Re_y = abs(dy_dt) * U_g * l / nu;
    % disp(dy_dt);
    % disp(U_g);
    % disp(l);
    % disp(Re_y);

    Re_x = abs(dx_dt) * U_g * l / nu;

    % Aerodynamic coefficients
    
    C_L1 = 5.2;
    C_L2 = 0.95;
    % C_D_pi_2 = 1.9; % Li et al

    if (Re_y < 1)
        C_D_pi_2 = 8;
    else
        C_D_pi_2 = 7.77 * Re_y^(-0.39);
    end

    % C_D0 = 0.1; % Li et al

    if (Re_x < 1)    
        C_D0 = 8;
    else
        C_D0 = 7.36 * Re_x^(-0.61);
    end

    C_D1 = 5;
    C_0_CP = 0.3;
    C_1_CP = 3.5;
    C_2_CP = 0.2;
    C_R = p(10);

    l_CM = l_CE * (rho_s - rho_f)/rho_s;
    
    % disp(C_D_pi_2);
    
    % Gust Equations 

    % Gust ratio (non-dimensional)

    G_r = p(8);

    % Gust duration (non-dimensional)

    t_G = 1;

    % Horizontal acceleration of gravity (a_G), time derivative of gust velocity profile, using dimensional t_G

    t_start = 15;
    a_G = 0 + ((2)^-1 * (pi / (t_G * l/U_g)) * sin(pi * (t - t_start) / t_G) * G_r * U_g) * (t >= t_start & t <= t_start + t_G);
   
    % a_G = 0;
    % End of gust equations (also added in the equations of motion below)
     
   
    % Non-dimentional mass
    
    % Iast = (rho_s * h * l) / (rho_f * l^2);
    Iast = (4 * rho_s * h) / (pi * rho_f * l);    
    % disp(Iast);

    % % Inertia for Li et al flyer (plastic in water) 
    % % Density of acrylic
    % rho_a = 1180;
    % % Shortest length of fin (longest length - width)
    % l_r = 0.0513;
    % % Radius of semicircle (width/2)
    % r = 0.00635;
    % % Span length of plate
    % s = 0.203;

    % e_x = l_CM/l;
    % Cathal's plot on Slack 14/06/23
    beta = h/l;
    gamma = rho_f / (rho_s - rho_f);
    % alpha depends on time t
    alpha = atan2((v_yp - omega * l_CM),v_xp); 

    % Inertia of flat plate (non-dim)
    
    Inertia_plate = ((rho_s * h * l) / 12) * (h^2 + l^2) * (4 / (pi * rho_f * l^4)); 
    % Inertia_plate_test = Inertia_plate * pi / 4;
    % disp(Inertia_plate_test);
    
    % disp(Inertia_plate);
    % Inertia of flyer from Li et al I* = 0.2

    Inertia_flyer_1 = 0.2 * pi * rho_f * l^4 / 32 * (4 / (pi * rho_f * l^4));
    % disp(Inertia_flyer_1);

    % Inertia_flyer_2: calculated entire flyer from Li et al (weight assumed point mass, not valid)

    % Inertia_flyer = ((rho_a * s * h * l) / 12 * (h^2 + l^2) + (rho_a * h * l_r * r) / 3 * (l_r^2+4*r^2) + (rho_a * h * pi * r^2) * (r^2 + l_r^2/2)) * 4 / (pi * rho_f * l^4);

    % Inertia_plate_flyer = (rho_a * s * h * l) / 12 * (h^2 + l^2) * 4 / (pi * rho_f * l^4);

    % Inertia_alsomitra = (1/12)*Iast*(beta^2+1)+Iast*e_x^2;

    % critical angle of attack at stall
    alpha0 = deg2rad(14);
    % delta is the smoothness of the transition from laminar to turbulent
    delta = deg2rad(6);

    % f activation function, it specifies laminar and stall regimes
    Falpha1 = ((1 - tanh((pi - abs(alpha) - alpha0)/delta))/2);
    Falpha2 = ((1 - tanh((abs(alpha) - alpha0)/delta))/2);
    Falpha3 = ((1 - tanh((alpha - alpha0)/delta))/2);
    Falpha4 = ((1 - tanh((pi - alpha - alpha0)/delta))/2);
    % Falpha = Falpha1.*(alpha>=-pi & alpha<=-pi/2) + Falpha2.*(alpha>=-pi/2 & alpha<=0) + Falpha3.*(alpha>=0 & alpha<=pi/2) + Falpha4.*(alpha>=pi/2 & alpha<=pi);

    % C_Lalpha = Falpha*C_L1.*sin(alpha) + (1-Falpha)*C_L2.*sin(2*alpha);
    C_Lalpha1 = Falpha1*C_L1.*sin(pi - abs(alpha)) + (1-Falpha1)*C_L2.*sin(2*(pi - abs(alpha)));
    C_Lalpha2 = Falpha2*C_L1.*sin(abs(alpha)) + (1-Falpha2)*C_L2.*sin(2*abs(alpha));
    C_Lalpha3 = Falpha3*C_L1.*sin(alpha) + (1-Falpha3)*C_L2.*sin(2*alpha);
    C_Lalpha4 = Falpha4*C_L1.*sin(pi - alpha) + (1-Falpha4)*C_L2.*sin(2*(pi - alpha));
    C_Lalpha = C_Lalpha1.*(alpha>=-pi & alpha<=-pi/2) - C_Lalpha2.*(alpha>-pi/2 & alpha<=0) + C_Lalpha3.*(alpha>0 & alpha<=pi/2) - C_Lalpha4.*(alpha>pi/2 & alpha<=pi);

    % C_Dalpha = Falpha.*(C_D0 + C_D1.*sin((alpha).^2)) + (1 - Falpha).*C_D_pi_2.*(sin(alpha).^2);
    C_Dalpha1 = Falpha1.*(C_D0 + C_D1.*sin((pi - abs(alpha)).^2)) + (1 - Falpha1).*C_D_pi_2.*(sin(pi - abs(alpha)).^2);
    C_Dalpha2 = Falpha2.*(C_D0 + C_D1.*sin((abs(alpha)).^2)) + (1 - Falpha2).*C_D_pi_2.*(sin(abs(alpha)).^2);
    C_Dalpha3 = Falpha3.*(C_D0 + C_D1.*sin((alpha).^2)) + (1 - Falpha3).*C_D_pi_2.*(sin(alpha).^2);
    C_Dalpha4 = Falpha4.*(C_D0 + C_D1.*sin((pi - alpha).^2)) + (1 - Falpha4).*C_D_pi_2.*(sin(pi - alpha).^2);
    C_Dalpha = C_Dalpha1.*(alpha>=-pi & alpha<-pi/2) + C_Dalpha2.*(alpha>=-pi/2 & alpha<0) + C_Dalpha3.*(alpha>=0 & alpha<pi/2) + C_Dalpha4.*(alpha>=pi/2 & alpha<=pi);

    %disp(C_Dalpha);

    % l_CP_alpha_l = Falpha.*(C_0_CP - C_1_CP.*alpha.^2) + (1-Falpha).*C_2_CP.*(1-alpha/(pi/2));
    l_CP_alpha_l1 = Falpha1.*(C_0_CP - C_1_CP.*(pi - abs(alpha)).^2) + (1-Falpha1).*C_2_CP.*(1-(pi - abs(alpha))/(pi/2));
    l_CP_alpha_l2 = Falpha2.*(C_0_CP - C_1_CP.*abs(alpha).^2) + (1-Falpha2).*C_2_CP.*(1-abs(alpha)/(pi/2));
    l_CP_alpha_l3 = Falpha3.*(C_0_CP - C_1_CP.*alpha.^2) + (1-Falpha3).*C_2_CP.*(1-alpha/(pi/2));
    l_CP_alpha_l4 = Falpha4.*(C_0_CP - C_1_CP.*(pi - alpha).^2) + (1-Falpha4).*C_2_CP.*(1-(pi - alpha)/(pi/2));
   
    epsilon_alpha = -l_CP_alpha_l1.*(alpha>=-pi & alpha<=-pi/2) + l_CP_alpha_l2.*(alpha>=-pi/2 & alpha<=0) + l_CP_alpha_l3.*(alpha>=0 & alpha<=pi/2) - l_CP_alpha_l4.*(alpha>=pi/2 & alpha<=pi);

    %% CHECK the following equations are all checked with syms Matlab, in the
    % online course https://matlabacademy.mathworks.com/R2020a/portal.html?course=symbolic#chapter=8&lesson=1&section=1
    % you can type the symbolic equation and get a graphical representation
    % as in Latex.
    
    L_Txy = (2/pi)*C_Lalpha.*sqrt(v_xp^2 + (v_yp - omega*e_x)^2);
    L_Tx = L_Txy.*(v_yp - omega*e_x);
    L_Ty = L_Txy.*(-v_xp);
    L_T = L_Tx + L_Ty;
  
    L_Rxy = (-2/pi)*C_R*omega;
    L_Rx = L_Rxy*(v_yp - omega*e_x);
    L_Ry = L_Rxy*(-v_xp);
    L_R = L_Rx + L_Ry;

    L = L_T + L_R;

    D_xy = (-2/pi)*C_Dalpha*sqrt(v_xp^2 + (v_yp - omega*e_x)^2);
    D_x = D_xy*v_xp;
    
    % disp(D_xy);
    
   
    % if D_x > 10
    %     a=1;
    % end
    D_y = D_xy*(v_yp - omega*e_x);
    D = D_x + D_y;
    
    % fprintf(D_x + " " + t +"\n");

    % plus sign applies for 2*l_CM/l < 1, when the CoM lies within the plate
    e_xplus = (2*e_x + 1).^4 + (2*e_x - 1).^4;
    e_xminus = (2*e_x + 1).^4 - (2*e_x - 1).^4;

    if 2*e_x <= 1 

        plus_minus = e_xplus + e_xminus;
    else

        plus_minus = e_xplus - e_xminus;
    end

    % Define dv_xpdt, dv_ypdt, domegadt, dthetadt, dx_dt and dy_dt from the ODEs

    % Alsomitra seed
    % domegadt = ((-C_D_pi_2/(32*pi))*omega*abs(omega)*plus_minus + ((L_Ty + D_y)*(epsilon_alpha - e_x)) - gamma*e_x*cos(theta))/ ((1 / 12) * Iast * (beta^2 + 1) + Iast * e_x^2 + 1 / 32 + e_x^2);
    
    % Flyer

    % domegadt = ((-C_D_pi_2 / (32 * pi)) * omega * abs(omega) * plus_minus + ((L_Ty + D_y) * (epsilon_alpha - e_x)) - gamma * e_x * cos(theta)) / (Inertia_flyer_1 + 1/32 + e_x^2);

    % Flat plate
   
    % domegadt = ((-C_D_pi_2 / (32 * pi)) * omega * abs(omega) * plus_minus + ((L_Ty + D_y) * (epsilon_alpha - e_x)) - gamma * e_x * cos(theta)) / (Inertia_plate + 1/32 + e_x^2);

    domegadt = 0;
 
    dv_xpdt = (1 / Iast) * ((Iast + 1) * omega * v_yp - e_x * omega^2 + (L_Tx + L_Rx) + D_x - 4 / pi * sin(theta) - Iast * (a_G / U_g^2 * l) * cos (theta)); % Modified for gust in positive x-direction

    dv_ypdt = (1 / (Iast + 1)) * (-Iast * omega * v_xp + domegadt * e_x + (L_Ty + L_Ry) + D_y - 4 / pi * cos(theta) + Iast * (a_G / U_g^2 * l) * sin (theta)); % Modified for gust in positive x-direction
    
    % dthetadt = omega;

    dthetadt = 0;
    
    % Create output column vector dydt
    dydt = [dv_xpdt; dv_ypdt; domegadt; dthetadt; dx_dt; dy_dt];
end